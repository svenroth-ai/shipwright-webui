/*
 * external/launch/runtime-chokepoint.ts — Codex Light §2.1's ONE chokepoint
 * for the main `/launch` route, plus §3.5/AC9's new-pipeline block.
 *
 * Called from `routes.ts` right after branch 4's fallback assigns
 * `commands`/`taskUpdate` and BEFORE `commandsCarryPermissionPerimeter`.
 * `task` (already loaded), `parsed` (the parsed launch body) and
 * `getProjectById` are already in scope there.
 *
 * `POST /tasks/:id/fork` does NOT share this chokepoint — it calls
 * `buildCopyCommands`/`buildCodexCommands`/`buildCodextenderCommands`
 * directly in `external/tasks/fork.ts` (§2.1's correction). Both import
 * `runtimeForTask` from here so the two insertion points agree on what
 * "this task's runtime" means.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  probeCodextenderLiveness,
  resolveCodextenderMaxContextTokens,
} from "../../core/codextender-proxy-probe.js";
import { buildCodexCommands } from "../../core/launcher-codex.js";
import { resolveCodextenderAuthToken } from "../../core/launcher-codextender.js";
import type { CopyCommandForms } from "../../core/launcher.js";
import { defaultRunShim } from "../../core/readiness-probe-run.js";
import type { ExternalTask, Runtime } from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import { applyCodextenderChokepoint } from "./runtime-chokepoint-codextender.js";
import { codexCliNotFoundError } from "./runtime-chokepoint-errors.js";

export type CodexIntegrationMode = "light" | "codextender";

/**
 * Plan-review HIGH fix (iterate-2026-09-23) — pin to the task's OWN stamped
 * mode once one exists, falling back to the live global setting only on a
 * task's very first Codex-runtime launch. Without this, a Resume straddling
 * a post-first-launch mode flip would silently switch mechanisms mid-session
 * (e.g. discard a real `codex` thread's history for a Codextender relaunch).
 * Pure/IO-free so `routes.ts` can unit-test the choice directly.
 */
export function resolveCodexIntegrationModeForLaunch(
  task: ExternalTask,
  liveGlobalSetting: CodexIntegrationMode | undefined,
): CodexIntegrationMode | undefined {
  return task.codexIntegrationMode ?? liveGlobalSetting;
}

/**
 * AC8 — "a task launched with a runtime whose CLI isn't installed fails at
 * launch time with one actionable message ... independent of the readiness
 * probe's own gate" (Spec/codex-light-webui.md §5.9, lines 789-792). The
 * per-task toggle means readiness can no longer treat either CLI as globally
 * required (the readiness fix lives in readiness-probe.ts), so THIS is where
 * an all-Claude machine actually gets stopped before a launch it can't run.
 * Not cached like /api/readiness's 15s TTL — a launch is a low-frequency,
 * user-initiated action, so a fresh check here is worth the one extra
 * process spawn for correctness at the moment that matters.
 *
 * `defaultRunShim`, not `defaultRun` — on Windows Codex CLI installs as a
 * `.cmd` shim (no `codex.exe`), which `defaultRun` cannot spawn under
 * `shell:false` (ENOENT even when Codex is genuinely installed and working).
 * See `defaultRunShim`'s own doc comment (iterate-2026-09-16-codex-probe-
 * win32-shim) for why this is a sibling probe rather than a `defaultRun` fix.
 */
export async function isCodexCliAvailable(): Promise<boolean> {
  const result = await defaultRunShim("codex", ["--version"]);
  return result.ok;
}

/** §2.1 — a plain field read on an already-loaded task, not a fallback chain. */
export function runtimeForTask(task: ExternalTask): Runtime {
  return task.runtime;
}

/**
 * ADR-309 generalized the `new-plain` JSONL-liveness special-case to every
 * Codex-runtime task (a Codex Light task never writes a Claude `.jsonl`
 * under any actionId). Codextender integration Part B.6 excludes
 * Codextender mode from that generalization: it drives ordinary `claude`
 * via the local proxy, so it DOES write a real `.jsonl` and the ordinary
 * `!firstJsonlObservedAt` transcript-poll path is already authoritative for
 * it, exactly like a plain Claude task. Shared by `ws-upgrade-handler.ts`
 * and `external/transcript/routes.ts` — their own companion-fix comments
 * point back here rather than re-typing the condition.
 */
export function isCodexNonCodextenderTask(task: ExternalTask): boolean {
  return task.runtime === "codex" && task.codexIntegrationMode !== "codextender";
}

/**
 * AC9 — a multi-phase single thread's "done" has no oracle row (§1.8); a
 * `new-pipeline` launch for a Codex task is blocked here, not silently
 * downgraded. Keys on `actionId === "new-pipeline"` (never `phase`, which
 * a pipeline launch never submits — `useNewIssueFormSubmit.ts`).
 *
 * Codextender integration Part B.6 — AC9's rationale (no thread/app-server
 * resume machinery, `codex-light-webui.md` §1.8) is specific to the real
 * `codex` CLI; a Codextender task drives ordinary `claude` underneath, so it
 * has the SAME pipeline/resume machinery a Claude-runtime task does. Bypass
 * keys on the FRESH `codexIntegrationMode` param (not `task.
 * codexIntegrationMode`), which is unset on a task's very first Codextender
 * launch — reading the stale/absent task field would wrongly block it.
 */
export function isCodexNewPipelineBlocked(
  task: ExternalTask,
  parsed: ParsedLaunchBody,
  codexIntegrationMode?: CodexIntegrationMode,
): boolean {
  if (codexIntegrationMode === "codextender") return false;
  return parsed.actionId === "new-pipeline" && runtimeForTask(task) === "codex";
}

/**
 * AC7 — "Campaign is 'Codex Light 2'" (deferred, still out of scope). The
 * campaign/step/master-run branches each build their own fixed command
 * server-side (`/shipwright-run`, `/shipwright-iterate "<specPath>"`, ...);
 * without this check this chokepoint would silently DISCARD that command
 * and override it with a generic `buildCodexCommands` resume/launch built
 * from `phase`/`description` — a behavior mismatch, not the spec's
 * required "block/explain". Keyed on the parsed body's own campaign-intent
 * fields (never persisted on the task — parse-body.ts), so it fires
 * exactly when a campaign launch surface (not an ordinary per-task
 * Launch/Resume) is the caller, resume or fresh start alike.
 *
 * Codextender integration Part B.6 — same bypass rationale as
 * `isCodexNewPipelineBlocked` above: AC7 is a real-`codex`-CLI limitation,
 * not one Codextender (ordinary `claude` underneath) inherits.
 */
export function isCodexCampaignBlocked(
  task: ExternalTask,
  parsed: ParsedLaunchBody,
  codexIntegrationMode?: CodexIntegrationMode,
): boolean {
  if (codexIntegrationMode === "codextender") return false;
  return (
    runtimeForTask(task) === "codex" &&
    (Boolean(parsed.campaignSlug) || Boolean(parsed.campaignStep) || parsed.masterRun)
  );
}

export interface RuntimeChokepointOk {
  commands: CopyCommandForms;
  taskUpdate: Partial<ExternalTask>;
}
export interface RuntimeChokepointBlocked {
  error: Record<string, unknown>;
  // 500 is the codextender_cwd_mismatch case only — a server-side data
  // inconsistency (the task's own commands were built from an unexpected
  // cwd), not a user-actionable 400.
  status: 400 | 500;
}

/**
 * The main-route half of §2.1. Returns the ORIGINAL `commands`/`taskUpdate`
 * unchanged for a Claude-runtime task (byte-identical to before this
 * feature existed); overrides with `buildCodexCommands` for a
 * Codex-runtime one; blocks per AC9 for a Codex `new-pipeline` launch.
 */
export async function applyRuntimeChokepoint(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  project: ExternalRouteProjectView | undefined;
  commands: CopyCommandForms;
  taskUpdate: Partial<ExternalTask>;
  /** Codextender integration Part B.6 — a FRESH read of the global
   *  `codexIntegrationMode` setting (never `task.codexIntegrationMode`,
   *  which is unset on this task's very first Codextender launch). Absent
   *  or `"light"` behaves exactly as before this feature existed. */
  codexIntegrationMode?: CodexIntegrationMode;
  /** The `codextenderPort` global setting; defaults to 4000 (matches the
   *  `codextender` CLI's own default) when omitted. */
  codextenderPort?: number;
  /** Test seam — defaults to a real `codex --version` probe. */
  checkCodexCliAvailable?: () => Promise<boolean>;
  /** Test seam — defaults to a real `GET /health/liveliness` probe of the
   *  Codextender proxy at `codextenderPort` (no auth required). */
  checkCodextenderProxyAvailable?: () => Promise<boolean>;
  /** Test seam — defaults to `resolveCodextenderAuthToken()` (reads
   *  `process.env.CODEXTENDER_AUTH_TOKEN`, no built-in fallback). */
  getCodextenderAuthToken?: () => string | undefined;
  /** Test seam — defaults to a real probe of the proxy's `/v1/models` for
   *  the selected alias's `max_input_tokens` (operator finding,
   *  2026-09-26). `model` is the same value passed to `buildCodextenderCommands`. */
  getCodextenderMaxContextTokens?: (model: string | undefined) => Promise<number | undefined>;
}): Promise<RuntimeChokepointOk | RuntimeChokepointBlocked> {
  const { task, parsed, project, commands, taskUpdate, codexIntegrationMode } = args;
  const checkCodexCliAvailable = args.checkCodexCliAvailable ?? isCodexCliAvailable;
  const codextenderPort = args.codextenderPort ?? 4000;
  const checkCodextenderProxyAvailable =
    args.checkCodextenderProxyAvailable ??
    (() => probeCodextenderLiveness(codextenderPort));
  const getCodextenderAuthToken = args.getCodextenderAuthToken ?? resolveCodextenderAuthToken;
  const getCodextenderMaxContextTokens =
    args.getCodextenderMaxContextTokens ??
    ((model: string | undefined) => resolveCodextenderMaxContextTokens(codextenderPort, model));

  if (isCodexNewPipelineBlocked(task, parsed, codexIntegrationMode)) {
    return {
      error: {
        error: "codex_new_pipeline_unsupported",
        detail:
          "Codex Light doesn't support multi-phase pipeline runs yet (\"Codex " +
          "Light 2\"). Switch this task's runtime to Claude, or launch each " +
          "phase as its own task.",
      },
      status: 400,
    };
  }

  if (isCodexCampaignBlocked(task, parsed, codexIntegrationMode)) {
    return {
      error: {
        error: "codex_campaign_unsupported",
        detail:
          "Codex Light doesn't support campaign launches yet (\"Codex Light " +
          "2\"). Switch this task's runtime to Claude to run it as part of a " +
          "campaign.",
      },
      status: 400,
    };
  }

  if (runtimeForTask(task) !== "codex") {
    return { commands, taskUpdate };
  }

  // Codextender integration Part B.3/B.6 — split out to
  // runtime-chokepoint-codextender.ts (bloat anti-ratchet, 2026-09-26).
  if (codexIntegrationMode === "codextender") {
    return applyCodextenderChokepoint({
      task,
      parsed,
      commands,
      taskUpdate,
      codextenderPort,
      checkCodextenderProxyAvailable,
      getCodextenderAuthToken,
      getCodextenderMaxContextTokens,
    });
  }

  // AC8 — see isCodexCliAvailable's doc comment above.
  if (!(await checkCodexCliAvailable())) {
    return { error: codexCliNotFoundError(), status: 400 };
  }

  // §4 resume state machine — we only ever know a `threadId` once a prior
  // launch has produced one, so its presence (not the client's `resume`
  // flag, which is Claude-JSONL-shaped) is the honest fresh-vs-resume
  // signal for a Codex task.
  const resume = Boolean(task.threadId);
  const hasAgentsMd = Boolean(
    project?.path && existsSync(path.join(project.path, "AGENTS.md")),
  );
  const codexCommands = buildCodexCommands({
    cwd: task.cwd,
    autonomy: parsed.autonomy ?? task.autonomy ?? "guided",
    resume,
    threadId: task.threadId,
    phase: parsed.phase ?? task.phase,
    description: parsed.description ?? task.description,
    hasAgentsMd,
    implementationModel: parsed.codexImplementationModel,
    planReviewModel: parsed.codexPlanReviewModel,
    reviewModel: parsed.codexReviewModel,
  });
  return {
    commands: codexCommands,
    taskUpdate: {
      ...taskUpdate,
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
      codexIntegrationMode: "light",
    },
  };
}
