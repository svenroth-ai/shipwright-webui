/*
 * useLaunchMasterRun — open a TaskDetail terminal that auto-runs the
 * single-session master `/shipwright-run` ONCE (campaign
 * webui-pipeline-convergence, sub-iterate W2).
 *
 * Mirrors `useLaunchCampaign` (create → launch → sessionStorage-handoff →
 * navigate, ADR-068-A1): the handoff key `webui:pending-auto-launch:<taskId>`
 * is read by `TaskDetailPage` on mount and dispatched into the embedded terminal
 * once it is writer + prompt-ready. The `/shipwright-run` master then drives
 * every phase via a phase-runner subagent in that one conversation — NO
 * per-phase Continue.
 *
 * This is a SIBLING of `useLaunchCampaign` (an autonomous-orchestrator launch),
 * NOT a per-phase pipeline continuation: it carries no phaseTaskId and creates
 * no phase shadow, so the `useContinuePipeline()` single-entry rule
 * (conventions rule 14, which governs per-phase Continue) does not apply.
 *
 * The command is built ENTIRELY server-side from the run's single_session
 * run_config (`launchMasterRun` → the master-run branch) — the client never
 * dictates the command (Architecture rule 1 / regression guard #19).
 *
 * The imperative `startMasterRun(args, deps)` is the testable core (no React);
 * the `useLaunchMasterRun()` hook injects the real deps + query invalidation.
 * Idempotency: the run's master shadow (`parentRunMaster && runId`) is reused
 * when present, so a second launch never spawns a second master.
 */

import { useQueryClient } from "@tanstack/react-query";

import { createTask, type CopyCommandForms } from "../lib/externalApi";
import { launchMasterRun } from "../lib/masterRunApi";
import { formatRunLabel } from "../lib/run-config-v2";

/** The subset of an ExternalTask the idempotent master-shadow lookup needs.
 *  `firstJsonlObservedAt` decides fresh-launch vs resume on reuse: a reused
 *  master whose `<uuid>.jsonl` already exists must RESUME (re-injecting
 *  `--session-id` would make Claude reject the duplicate session id). */
export interface MasterShadowCandidate {
  taskId: string;
  /** The owning project — the shadow lookup is scoped to it (F06). A duplicated
   *  project dir copies `runId` verbatim into its `shipwright_run_config.json`,
   *  so `runId` + `parentRunMaster` alone are NOT a unique master key; the
   *  wrong project's master would be reused/resumed without this filter. */
  projectId?: string;
  runId?: string;
  parentRunMaster?: boolean;
  firstJsonlObservedAt?: string | null;
}

export interface LaunchMasterRunArgs {
  project: { id: string; path: string };
  /** The single_session RunConfigV2 for this run (only `runId` is used here). */
  config: { runId: string };
  /** Current task list — the run's master shadow is reused when it exists. */
  tasks: MasterShadowCandidate[];
}

export type LaunchMasterRunResult =
  | { ok: true; taskId: string; commands: CopyCommandForms; reused: boolean; resume: boolean }
  | { ok: false; reason: "create_failed" | "launch_failed"; detail?: string };

export interface LaunchMasterRunDeps {
  create: (args: {
    title: string;
    cwd: string;
    projectId: string;
    runId: string;
    parentRunMaster: boolean;
  }) => Promise<{ taskId: string }>;
  launch: (taskId: string, resume: boolean) => Promise<{ commands: CopyCommandForms }>;
  /** Auto-launch channel; defaults to the sessionStorage handoff TaskDetailPage reads. */
  handoff?: (taskId: string, commands: CopyCommandForms, resume: boolean) => void;
}

/** Default handoff — best-effort sessionStorage write (privacy mode → silently
 *  skipped; the TaskDetail header Resume CTA is the manual fallback). Same shape
 *  as `useLaunchCampaign.writePendingAutoLaunch`; `resume` reflects fresh-start
 *  (`/shipwright-run`) vs resume of an established master (`--resume`). */
function writePendingAutoLaunch(
  taskId: string,
  commands: CopyCommandForms,
  resume: boolean,
): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      `webui:pending-auto-launch:${taskId}`,
      JSON.stringify({ commands, resume, ts: Date.now() }),
    );
  } catch {
    // sessionStorage disabled — auto-launch unavailable; task is still created
    // + launched server-side, so TaskDetail can relaunch manually.
  }
}

/** The run's existing master shadow WITHIN this project, if any
 *  (`parentRunMaster && runId && projectId`). Project-scoped (F06): matching on
 *  `parentRunMaster + runId` over the ALL-projects task list would reuse a
 *  DIFFERENT project's master when a duplicated project dir shares the `runId`. */
function findMasterShadow(
  tasks: MasterShadowCandidate[],
  runId: string,
  projectId: string,
): MasterShadowCandidate | undefined {
  // Never cross-match on an absent scope: without this guard a candidate whose
  // `projectId` is undefined would `=== undefined` a missing arg and reuse the
  // wrong master. `args.project.id` is always set today, but the guard makes the
  // project-scoping invariant explicit + falsifiable.
  if (!projectId) return undefined;
  return tasks.find(
    (t) =>
      t.parentRunMaster === true &&
      t.runId === runId &&
      t.projectId === projectId,
  );
}

/**
 * Shared create-or-reuse → launch → handoff core. Reuses the run's master
 * shadow when present (idempotent — never a second master); otherwise creates
 * one (`parentRunMaster: true`, `runId`). The server is the command authority,
 * so this layer never touches the command string.
 *
 * Fresh-vs-resume: a newly created (or reused-but-never-launched) master starts
 * fresh (`/shipwright-run`); a reused master whose `<uuid>.jsonl` already exists
 * RESUMES (`--resume <uuid>` via the legacy branch) — re-injecting
 * `--session-id` would make Claude reject the duplicate session id.
 */
export async function startMasterRun(
  args: LaunchMasterRunArgs,
  deps: LaunchMasterRunDeps,
): Promise<LaunchMasterRunResult> {
  const existing = findMasterShadow(args.tasks, args.config.runId, args.project.id);

  let taskId: string;
  let reused: boolean;
  // An established master (JSONL on disk) must resume; anything else is fresh.
  const resume = Boolean(existing?.firstJsonlObservedAt);
  if (existing) {
    taskId = existing.taskId;
    reused = true;
  } else {
    try {
      const task = await deps.create({
        title: `${formatRunLabel(args.config.runId)} master`,
        cwd: args.project.path,
        projectId: args.project.id,
        runId: args.config.runId,
        parentRunMaster: true,
      });
      taskId = task.taskId;
      reused = false;
    } catch (err) {
      return {
        ok: false,
        reason: "create_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  let commands: CopyCommandForms;
  try {
    const result = await deps.launch(taskId, resume);
    commands = result.commands;
  } catch (err) {
    return {
      ok: false,
      reason: "launch_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  (deps.handoff ?? writePendingAutoLaunch)(taskId, commands, resume);
  return { ok: true, taskId, commands, reused, resume };
}

/** React hook — preferred form. Injects the real deps + invalidates task lists. */
export function useLaunchMasterRun() {
  const qc = useQueryClient();
  return async function launchMasterRunFromHook(
    args: LaunchMasterRunArgs,
  ): Promise<LaunchMasterRunResult> {
    const result = await startMasterRun(args, {
      create: createTask,
      launch: launchMasterRun,
    });
    if (result.ok) {
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
    }
    return result;
  };
}
