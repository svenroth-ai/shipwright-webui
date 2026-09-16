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
 * `buildCopyCommands`/`buildCodexCommands` directly in
 * `external/tasks/lifecycle.ts` (§2.1's correction). Both import
 * `runtimeForTask` from here so the two insertion points agree on what
 * "this task's runtime" means.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildCodexCommands } from "../../core/launcher-codex.js";
import type { CopyCommandForms } from "../../core/launcher.js";
import { installHint } from "../../core/readiness-install-hints.js";
import { defaultRunShim } from "../../core/readiness-probe-run.js";
import type { ExternalTask, Runtime } from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";

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
 * AC9 — a multi-phase single thread's "done" has no oracle row (§1.8); a
 * `new-pipeline` launch for a Codex task is blocked here, not silently
 * downgraded. Keys on `actionId === "new-pipeline"` (never `phase`, which
 * a pipeline launch never submits — `useNewIssueFormSubmit.ts`).
 */
export function isCodexNewPipelineBlocked(
  task: ExternalTask,
  parsed: ParsedLaunchBody,
): boolean {
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
 */
export function isCodexCampaignBlocked(
  task: ExternalTask,
  parsed: ParsedLaunchBody,
): boolean {
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
  status: 400;
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
  /** Test seam — defaults to a real `codex --version` probe. */
  checkCodexCliAvailable?: () => Promise<boolean>;
}): Promise<RuntimeChokepointOk | RuntimeChokepointBlocked> {
  const { task, parsed, project, commands, taskUpdate } = args;
  const checkCodexCliAvailable = args.checkCodexCliAvailable ?? isCodexCliAvailable;

  if (isCodexNewPipelineBlocked(task, parsed)) {
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

  if (isCodexCampaignBlocked(task, parsed)) {
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

  // AC8 — see isCodexCliAvailable's doc comment above.
  if (!(await checkCodexCliAvailable())) {
    return {
      error: {
        error: "codex_cli_not_found",
        detail:
          "This task's runtime is Codex, but the Codex CLI isn't installed " +
          "on this machine. " + installHint("codex", os.platform()) +
          ", or switch this task's runtime to Claude.",
      },
      status: 400,
    };
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
  });
  return {
    commands: codexCommands,
    taskUpdate: {
      ...taskUpdate,
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
    },
  };
}
