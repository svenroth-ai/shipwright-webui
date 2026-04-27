/*
 * Read `<projectPath>/shipwright_run_config.json` and return a typed view.
 *
 * The orchestrator writes the file atomically (rename), but on Windows the
 * brief rename window can still produce EBUSY/EPERM/EACCES, and a polling
 * reader can momentarily catch a partial parse if filesystem caching lags.
 * Mitigations:
 *   - Retry 3 times with 50/150/450 ms backoff on SyntaxError + EBUSY /
 *     EPERM / EACCES (mirrors core/session-watcher.ts torn-read budget but
 *     shorter, since the file is small and rotates fast).
 *   - Fall back to a per-path last-good cache (5s TTL) so a torn read
 *     never produces an `invalid` flap visible to the UI.
 *
 * Per-row fault isolation for `phase_tasks[]`: a malformed row is dropped
 * AND surfaced via `diagnostics.droppedPhaseTaskIds[]` — silent drop hides
 * orchestrator-state corruption (review O #13). The whole file is still
 * accepted so downstream UI shows the run with a "N entries unreadable"
 * banner instead of a blank screen.
 *
 * v1 detection: `schemaVersion` missing OR === 1 (the framework hard-cuts
 * v1 in its phase-lifecycle subcommands; webui treats it as legacy-flat
 * and renders today's pre-pipeline UI).
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  PHASE_TASK_ID_PATTERN,
  RUN_ID_PATTERN,
  RUN_PHASES,
  SESSION_UUID_PATTERN,
  SLASH_COMMAND_PATTERN,
  type PhaseTask,
  type PhaseTaskStatus,
  type RunConditions,
  type RunConfigV2,
  type RunPhase,
  type RunStatus,
  type SplitMode,
} from "../types/run-config-v2.js";

export interface ReaderDiagnostics {
  /** phase_task entries that failed validation and were dropped. */
  droppedPhaseTaskIds: string[];
  /** Non-fatal anomalies the UI can surface (currently used for retry hints). */
  warnings: string[];
}

export type RunConfigReadResult =
  | { status: "missing" }
  | { status: "v1_legacy" }
  | { status: "ok"; config: RunConfigV2; diagnostics: ReaderDiagnostics }
  | { status: "invalid"; reason: string };

const RUN_CONFIG_FILENAME = "shipwright_run_config.json";

const RETRY_DELAYS_MS = [50, 150, 450] as const;
const LAST_GOOD_TTL_MS = 5000;

interface LastGood {
  expiresAt: number;
  result: Extract<RunConfigReadResult, { status: "ok" }>;
}
const lastGoodCache = new Map<string, LastGood>();

const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
function isRetryable(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && RETRYABLE_FS_CODES.has(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export interface ReadRunConfigDeps {
  /** Injected for tests; defaults to fs/promises.readFile + utf-8. */
  readFile?: (path: string) => Promise<string>;
  /** Injected for tests; defaults to fs/promises.stat. */
  stat?: (path: string) => Promise<{ mtimeMs: number } | null>;
  /** Injected for tests so they don't actually wait the backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the default `Date.now`. Used by cache-TTL tests. */
  now?: () => number;
}

export async function readRunConfig(
  projectPath: string,
  deps: ReadRunConfigDeps = {},
): Promise<RunConfigReadResult> {
  const path = join(projectPath, RUN_CONFIG_FILENAME);
  const fsRead = deps.readFile ?? ((p: string) => readFile(p, "utf-8"));
  const fsStat =
    deps.stat ??
    (async (p: string) => {
      try {
        const s = await stat(p);
        return { mtimeMs: s.mtimeMs };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") return null;
        throw err;
      }
    });
  const wait = deps.sleep ?? sleep;
  const now = deps.now ?? (() => Date.now());

  // Quick existence probe — no retry on ENOENT (truly missing is a stable
  // state; we don't pretend it might come back in 50ms).
  let st: { mtimeMs: number } | null;
  try {
    st = await fsStat(path);
  } catch (err) {
    return { status: "invalid", reason: `stat failed: ${stringifyErr(err)}` };
  }
  if (st === null) return { status: "missing" };

  // Read with retry budget. SyntaxError / EBUSY / EPERM / EACCES → retry.
  let lastError: unknown = null;
  let raw: string | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      raw = await fsRead(path);
      break;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
  if (raw === null) {
    // All retries exhausted on a retryable error → fall back to last-good
    // cache if available within TTL.
    const cached = lastGoodCache.get(path);
    if (cached && cached.expiresAt > now()) {
      return {
        ...cached.result,
        diagnostics: {
          ...cached.result.diagnostics,
          warnings: [
            ...cached.result.diagnostics.warnings,
            `read retried 3x and fell back to last-good cache: ${stringifyErr(lastError)}`,
          ],
        },
      };
    }
    return { status: "invalid", reason: `read failed: ${stringifyErr(lastError)}` };
  }

  // Parse with retry budget on SyntaxError (torn-read mid-rename window).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (isRetryable(err)) {
      // One more re-read pass for SyntaxError specifically — orchestrator's
      // atomic write window is short.
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        await wait(RETRY_DELAYS_MS[attempt] ?? 0);
        try {
          const reread = await fsRead(path);
          parsed = JSON.parse(reread);
          break;
        } catch {
          // keep going
        }
      }
      if (parsed === undefined) {
        const cached = lastGoodCache.get(path);
        if (cached && cached.expiresAt > now()) {
          return {
            ...cached.result,
            diagnostics: {
              ...cached.result.diagnostics,
              warnings: [
                ...cached.result.diagnostics.warnings,
                "torn read on JSON parse; served last-good cache",
              ],
            },
          };
        }
        return { status: "invalid", reason: "torn JSON read on retry" };
      }
    } else {
      return { status: "invalid", reason: `parse failed: ${stringifyErr(err)}` };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", reason: "top-level is not an object" };
  }
  const top = parsed as Record<string, unknown>;
  const sv = top.schemaVersion;
  if (sv === undefined || sv === null || sv === 1) return { status: "v1_legacy" };
  if (sv !== 2) return { status: "invalid", reason: `schemaVersion ${String(sv)} not supported` };

  const validation = validateRunConfigV2(top);
  if (validation.status === "invalid") return validation;

  const result: Extract<RunConfigReadResult, { status: "ok" }> = {
    status: "ok",
    config: validation.config,
    diagnostics: validation.diagnostics,
  };
  lastGoodCache.set(path, {
    expiresAt: now() + LAST_GOOD_TTL_MS,
    result,
  });
  return result;
}

/** Test helper — drops the per-path last-good cache. */
export function clearRunConfigReaderCache(): void {
  lastGoodCache.clear();
}

// ---------------- validation ----------------

function validateRunConfigV2(
  top: Record<string, unknown>,
):
  | { status: "ok"; config: RunConfigV2; diagnostics: ReaderDiagnostics }
  | { status: "invalid"; reason: string } {
  const runId = top.runId;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    return { status: "invalid", reason: "runId missing or malformed" };
  }
  const status = top.status;
  if (!isRunStatus(status)) {
    return { status: "invalid", reason: `status ${JSON.stringify(status)} not recognized` };
  }
  const scope = top.scope;
  if (scope !== "full_app" && scope !== "extension") {
    return { status: "invalid", reason: `scope ${JSON.stringify(scope)} not recognized` };
  }
  const autonomy = top.autonomy;
  if (autonomy !== "guided" && autonomy !== "autonomous") {
    return { status: "invalid", reason: `autonomy ${JSON.stringify(autonomy)} not recognized` };
  }
  if (typeof top.deploy_target !== "string") {
    return { status: "invalid", reason: "deploy_target missing" };
  }

  const pipeline = top.pipeline;
  if (!Array.isArray(pipeline) || !pipeline.every(isRunPhase)) {
    return { status: "invalid", reason: "pipeline must be an array of valid phases" };
  }

  const runConditions = validateRunConditions(top.runConditions);
  if (runConditions === null) {
    return { status: "invalid", reason: "runConditions malformed" };
  }

  const splits_frozen = Array.isArray(top.splits_frozen)
    ? top.splits_frozen.filter((v): v is string => typeof v === "string")
    : null;
  if (splits_frozen === null) {
    return { status: "invalid", reason: "splits_frozen must be an array of strings" };
  }

  const completedRaw = top.completed_phase_task_ids;
  if (
    !Array.isArray(completedRaw) ||
    !completedRaw.every(
      (v): v is string => typeof v === "string" && PHASE_TASK_ID_PATTERN.test(v),
    )
  ) {
    return {
      status: "invalid",
      reason: "completed_phase_task_ids must be an array of phaseTaskId strings",
    };
  }
  const completed_phase_task_ids = completedRaw as string[];

  if (typeof top.created_at !== "string") {
    return { status: "invalid", reason: "created_at missing" };
  }

  const phaseTasksRaw = top.phase_tasks;
  if (!Array.isArray(phaseTasksRaw)) {
    return { status: "invalid", reason: "phase_tasks must be an array" };
  }

  const droppedPhaseTaskIds: string[] = [];
  const phase_tasks: PhaseTask[] = [];
  for (let i = 0; i < phaseTasksRaw.length; i++) {
    const row = phaseTasksRaw[i];
    const validated = validatePhaseTask(row);
    if (validated === null) {
      const candidateId =
        row && typeof row === "object" && "phaseTaskId" in (row as Record<string, unknown>)
          ? String((row as Record<string, unknown>).phaseTaskId)
          : `index_${i}`;
      droppedPhaseTaskIds.push(candidateId);
      continue;
    }
    phase_tasks.push(validated);
  }

  const config: RunConfigV2 = {
    schemaVersion: 2,
    runId,
    scope: scope as "full_app" | "extension",
    profile: typeof top.profile === "string" ? top.profile : top.profile === null ? null : undefined,
    autonomy: autonomy as "guided" | "autonomous",
    deploy_target: top.deploy_target as string,
    pipeline: pipeline as RunPhase[],
    runConditions,
    splits_frozen,
    status,
    completed_phase_task_ids,
    phase_tasks,
    created_at: top.created_at as string,
  };
  if (typeof top.updated_at === "string") config.updated_at = top.updated_at;
  if (top.phase_history && typeof top.phase_history === "object" && !Array.isArray(top.phase_history)) {
    config.phase_history = top.phase_history as Record<string, unknown>;
  }
  if (Array.isArray(top.iterate_history)) config.iterate_history = top.iterate_history;
  if (Array.isArray(top.validation_issues)) config.validation_issues = top.validation_issues;
  if (Array.isArray(top.validation_notes)) config.validation_notes = top.validation_notes;

  return {
    status: "ok",
    config,
    diagnostics: { droppedPhaseTaskIds, warnings: [] },
  };
}

function validateRunConditions(raw: unknown): RunConditions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.securityEnabled !== "boolean") return null;
  if (typeof r.aikidoClientIdPresent !== "boolean") return null;
  let splitMode: SplitMode;
  if (r.splitMode === null || r.splitMode === undefined) {
    splitMode = null;
  } else if (r.splitMode === "none" || r.splitMode === "per_split") {
    splitMode = r.splitMode;
  } else {
    return null;
  }
  return {
    securityEnabled: r.securityEnabled,
    aikidoClientIdPresent: r.aikidoClientIdPresent,
    splitMode,
  };
}

function validatePhaseTask(raw: unknown): PhaseTask | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.phaseTaskId !== "string" || !PHASE_TASK_ID_PATTERN.test(r.phaseTaskId)) return null;
  if (!isRunPhase(r.phase)) return null;
  if (!(typeof r.splitId === "string" || r.splitId === null)) return null;
  if (typeof r.sessionUuid !== "string" || !SESSION_UUID_PATTERN.test(r.sessionUuid)) return null;
  if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) return null;
  if (!isPhaseTaskStatus(r.status)) return null;
  if (typeof r.title !== "string") return null;
  if (typeof r.slashCommand !== "string" || !SLASH_COMMAND_PATTERN.test(r.slashCommand)) return null;
  if (
    !Array.isArray(r.prerequisites) ||
    !r.prerequisites.every(
      (p): p is string => typeof p === "string" && PHASE_TASK_ID_PATTERN.test(p),
    )
  ) {
    return null;
  }
  if (typeof r.executionCount !== "number" || !Number.isInteger(r.executionCount) || r.executionCount < 0) {
    return null;
  }
  if (typeof r.createdAt !== "string") return null;

  // Defensive: plan/build phases CAN have splitId; everyone else must be null.
  // The schema's allOf enforces this; we mirror the constraint to drop bad rows.
  if (r.splitId !== null && r.phase !== "plan" && r.phase !== "build") return null;

  const out: PhaseTask = {
    phaseTaskId: r.phaseTaskId,
    phase: r.phase,
    splitId: r.splitId,
    sessionUuid: r.sessionUuid,
    version: r.version,
    status: r.status,
    title: r.title,
    slashCommand: r.slashCommand,
    prerequisites: r.prerequisites as string[],
    executionCount: r.executionCount,
    createdAt: r.createdAt,
  };
  if (typeof r.description === "string") out.description = r.description;
  if (typeof r.launchCommandHint === "string") out.launchCommandHint = r.launchCommandHint;
  if (typeof r.claimedBySessionUuid === "string" || r.claimedBySessionUuid === null) {
    out.claimedBySessionUuid = r.claimedBySessionUuid;
  }
  if (typeof r.claimAttemptedAt === "string" || r.claimAttemptedAt === null) {
    out.claimAttemptedAt = r.claimAttemptedAt;
  }
  if (typeof r.awaitingLaunchAt === "string" || r.awaitingLaunchAt === null) {
    out.awaitingLaunchAt = r.awaitingLaunchAt;
  }
  if (typeof r.startedAt === "string" || r.startedAt === null) out.startedAt = r.startedAt;
  if (typeof r.completedAt === "string" || r.completedAt === null) out.completedAt = r.completedAt;
  if (r.result && typeof r.result === "object" && !Array.isArray(r.result)) {
    out.result = r.result as PhaseTask["result"];
  } else if (r.result === null) {
    out.result = null;
  }
  if (Array.isArray(r.errors) && r.errors.every((e): e is string => typeof e === "string")) {
    out.errors = r.errors;
  }
  return out;
}

function isRunPhase(v: unknown): v is RunPhase {
  return typeof v === "string" && (RUN_PHASES as readonly string[]).includes(v);
}

function isRunStatus(v: unknown): v is RunStatus {
  return v === "in_progress" || v === "complete" || v === "failed" || v === "needs_validation";
}

function isPhaseTaskStatus(v: unknown): v is PhaseTaskStatus {
  return (
    v === "backlog" ||
    v === "awaiting_launch" ||
    v === "in_progress" ||
    v === "done" ||
    v === "failed" ||
    v === "skipped"
  );
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
