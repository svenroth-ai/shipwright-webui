/*
 * Hand-rolled mirror of the framework's `run_config.v2.schema.json`.
 *
 * Source (authoritative): shared/schemas/run_config.v2.schema.json
 * in the sister `shipwright` repo (merged 2026-04-25 as commit 7d402d3).
 *
 * Why hand-rolled instead of codegen:
 *   - keeps webui's dependency surface minimal (no JSON-Schema validator)
 *   - matches the per-row fault-isolation pattern used by sdk-sessions-store
 *
 * Drift safety net: server/src/test/fixtures/run-config-v2-sample.json holds
 * a real orchestrator-produced sample. The reader-test asserts every required
 * field is recognized — when the framework grows the schema, that test fails
 * and forces a deliberate update on this side.
 *
 * ADR ref: agent_docs/decision_log.md ADR-001 (multi-session lifecycle).
 */

export type RunPhase =
  | "project"
  | "design"
  | "plan"
  | "build"
  | "test"
  | "security"
  | "changelog"
  | "deploy";

export const RUN_PHASES: readonly RunPhase[] = [
  "project",
  "design",
  "plan",
  "build",
  "test",
  "security",
  "changelog",
  "deploy",
] as const;

export type SplitMode = "none" | "per_split" | null;

export type RunStatus = "in_progress" | "complete" | "failed" | "needs_validation";

/**
 * Pipeline execution mode (schema field `run_config.mode`).
 *
 *  - `single_session` — the /shipwright-run master drives every phase via a
 *    phase-runner subagent in ONE conversation; the sole supported FRESH-write
 *    mode (SS8, 2026-07-08). Runs on every surface.
 *  - `multi_session`  — each phase is its own external UUID-bound Claude
 *    session (pre-SS1 behaviour). DEPRECATED, retained for back-compat.
 *
 * OPTIONAL on disk (NOT in the schema's `required`): a mode-less legacy config
 * reads as `DEFAULT_RUN_MODE`. Mirrors shared/schemas/run_config.v2.schema.json.
 */
export type RunMode = "multi_session" | "single_session";

export const RUN_MODES: readonly RunMode[] = [
  "multi_session",
  "single_session",
] as const;

/**
 * Absent-read fallback for `mode`. MUST equal the schema `default` and the
 * framework's `config_io.run_mode` absent-read so a consumer applying schema
 * defaults never silently reinterprets a mode-less legacy run.
 */
export const DEFAULT_RUN_MODE: RunMode = "multi_session";

export type PhaseTaskStatus =
  | "backlog"
  | "awaiting_launch"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped";

export const TERMINAL_PHASE_TASK_STATUSES: readonly PhaseTaskStatus[] = [
  "done",
  "failed",
  "skipped",
] as const;

export interface RunConditions {
  securityEnabled: boolean;
  splitMode: SplitMode;
  aikidoClientIdPresent: boolean;
}

export interface PhaseTaskResult {
  ok?: boolean;
  artifacts?: string[];
  [extra: string]: unknown;
}

export interface PhaseTask {
  phaseTaskId: string; // /^ptk-[0-9a-f]{4,}$/
  phase: RunPhase;
  splitId: string | null;
  sessionUuid: string; // uuid v4
  version: number; // >= 1
  status: PhaseTaskStatus;
  title: string;
  description?: string;
  slashCommand: string; // /^\/shipwright-(project|design|plan|build|test|security|changelog|deploy)$/
  launchCommandHint?: string;
  prerequisites: string[]; // PhaseTaskIds
  claimedBySessionUuid?: string | null;
  claimAttemptedAt?: string | null;
  executionCount: number; // >= 0
  createdAt: string;
  awaitingLaunchAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  result?: PhaseTaskResult | null;
  errors?: string[];
}

export interface RunConfigV2 {
  schemaVersion: 2;
  runId: string; // /^run-[0-9a-f]{8}$/
  scope: "full_app" | "extension";
  profile?: string | null;
  autonomy: "guided" | "autonomous";
  /** OPTIONAL; absent → DEFAULT_RUN_MODE via resolveRunMode(). See RunMode. */
  mode?: RunMode;
  deploy_target: string;
  pipeline: RunPhase[];
  runConditions: RunConditions;
  splits_frozen: string[];
  status: RunStatus;
  completed_phase_task_ids: string[];
  phase_tasks: PhaseTask[];
  phase_history?: Record<string, unknown>;
  iterate_history?: unknown[];
  created_at: string;
  updated_at?: string;
  validation_issues?: unknown[];
  validation_notes?: unknown[];
  last_compliance_update?: Record<string, unknown>;
  // Extra fields tolerated (additionalProperties: true in schema).
  [extra: string]: unknown;
}

// ---------- format helpers (used by route + UI) ----------

export const RUN_ID_PATTERN = /^run-[0-9a-f]{8}$/;
export const PHASE_TASK_ID_PATTERN = /^ptk-[0-9a-f]{4,}$/;
export const SLASH_COMMAND_PATTERN =
  /^\/shipwright-(project|design|plan|build|test|security|changelog|deploy)$/;
export const SESSION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constrained character class for `splitId` when used in shell-interpolated
 * positions (specifically the `--name` argument). The underlying value on
 * disk can be any string per the schema, but we refuse to interpolate
 * anything outside this class to keep shell escaping bullet-proof on all
 * three target shells (PS / cmd / POSIX). Plan A7.
 */
export const SPLIT_ID_SAFE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * `Run-{shortRunId}` label. `shortRunId` is the 4-char hex slice after the
 * "run-" prefix. Falls back to the full runId when the shape ever drifts
 * (review O #15) so the label stays informative rather than truncated.
 */
export function formatRunLabel(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) return runId;
  return `Run-${runId.slice(4, 8)}`;
}

/**
 * Build the `--name` value for a phase-task launch:
 *   "Run-{shortRunId} / {phase}[ / {splitId}]"
 *
 * `splitId` is validated against SPLIT_ID_SAFE_PATTERN; if it fails we throw
 * rather than emit a name that might break shell escaping. Phase is enum-
 * bounded by the type system already.
 */
export function buildPhaseTaskName(args: {
  runId: string;
  phase: RunPhase;
  splitId: string | null;
}): string {
  const label = formatRunLabel(args.runId);
  if (args.splitId === null || args.splitId === undefined) {
    return `${label} / ${args.phase}`;
  }
  if (!SPLIT_ID_SAFE_PATTERN.test(args.splitId)) {
    throw new Error(
      `splitId ${JSON.stringify(args.splitId)} contains characters outside [A-Za-z0-9._-]`,
    );
  }
  return `${label} / ${args.phase} / ${args.splitId}`;
}

/**
 * `readyToLaunchTasks[]` derivation: every phase_task whose status is
 * `awaiting_launch` AND every prerequisite is in
 * `completed_phase_task_ids[]`. Order = array order. Pure function — used
 * by the reader to produce a UX hint, NOT used for state mutation
 * decisions (the framework's state machine is the authority).
 */
export function deriveReadyToLaunchTasks(config: RunConfigV2): PhaseTask[] {
  const completed = new Set(config.completed_phase_task_ids);
  return config.phase_tasks.filter(
    (t) =>
      t.status === "awaiting_launch" &&
      t.prerequisites.every((p) => completed.has(p)),
  );
}

export function isTerminalPhaseTaskStatus(s: PhaseTaskStatus): boolean {
  return TERMINAL_PHASE_TASK_STATUSES.includes(s);
}

export function isRunMode(v: unknown): v is RunMode {
  return v === "multi_session" || v === "single_session";
}

/**
 * Resolve a run's execution mode. Absent OR unrecognised → DEFAULT_RUN_MODE
 * ("multi_session") — matching the schema note that "an unrecognised value is
 * also read as multi_session so a typo can't select an unbuilt path". Stays
 * defensive even though the reader already drops unrecognised values.
 */
export function resolveRunMode(config: { mode?: RunMode }): RunMode {
  return isRunMode(config.mode) ? config.mode : DEFAULT_RUN_MODE;
}

/**
 * Parse the raw `mode` value off a run-config for the reader. Valid → the mode;
 * absent/null → `{}` (no warning; consumers default via resolveRunMode); an
 * UNRECOGNISED value → a warning and NO mode (the reader NEVER rejects the
 * config over `mode`, so a typo can't select an unbuilt path). Lives next to
 * the RunMode type instead of growing the at-ceiling run-config-reader.
 */
export function parseRunMode(raw: unknown): { mode?: RunMode; warnings: string[] } {
  if (isRunMode(raw)) return { mode: raw, warnings: [] };
  if (raw === undefined || raw === null) return { warnings: [] };
  return {
    warnings: [`mode ${JSON.stringify(raw)} not recognized; treating as ${DEFAULT_RUN_MODE}`],
  };
}

// ---------- torn-read retry (server-side; used by run-config-reader) ----------

/**
 * Standard run-config torn-read backoff schedule (ms). The orchestrator writes
 * the config atomically (rename); on Windows the brief rename window can throw
 * EBUSY/EPERM/EACCES or yield a partial JSON parse. The reader retries on this
 * schedule before falling back to its last-good cache.
 */
export const RUN_CONFIG_RETRY_DELAYS_MS: readonly number[] = [50, 150, 450];

const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * A torn read is retryable when it is a SyntaxError (partial JSON caught mid
 * write) OR an EBUSY/EPERM/EACCES fs error (Windows rename window). ENOENT is
 * deliberately NOT retryable — a truly-absent file is a stable state.
 */
export function isRetryableTornRead(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && RETRYABLE_FS_CODES.has(code));
}

export type RetryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Retry an async fs op on retryable torn-read errors using the standard
 * backoff. Resolves `{ ok:true, value }` on success, or `{ ok:false, error }`
 * once the budget is exhausted or a non-retryable error is hit. Lives next to
 * the RunConfig types (not inline in the reader) because run-config-reader.ts
 * is at its bloat ceiling — same rationale as parseRunMode. F15.
 */
export async function retryTornRead<T>(
  op: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
  delays: readonly number[] = RUN_CONFIG_RETRY_DELAYS_MS,
): Promise<RetryOutcome<T>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return { ok: true, value: await op() };
    } catch (err) {
      lastError = err;
      if (!isRetryableTornRead(err) || attempt === delays.length) break;
      await wait(delays[attempt] ?? 0);
    }
  }
  return { ok: false, error: lastError };
}
