/*
 * Single shared continuation-launch handler for v2 multi-session runs.
 *
 * Plan B4 / review O #7: every continuation entry point — Master TaskCard
 * CTA, Continue Pipeline modal, future TaskDetail header — funnels through
 * THIS hook so re-fetch + idempotent shadow lookup + launch happen as one
 * atomic action regardless of where the user clicks. No bypass.
 *
 * Steps:
 *   1. Refetch run-config (the cached snapshot the menu was rendered from
 *      may be stale — pipeline polling is 5s).
 *   2. Locate target phase_task by phaseTaskId.
 *   3. Pre-flight gate: status === "awaiting_launch" + prereqs completed.
 *      If not → { ok: false, reason }.
 *   4. createTask() with phase-task linkage. Server returns the existing
 *      shadow if one already maps to phaseTaskId (idempotency).
 *   5. launchTask() with phaseTaskRef. Server re-verifies before producing
 *      a command (review O #2 — the security boundary).
 *   6. Pick platform command + write to clipboard.
 *   7. Return { ok: true, taskId, commands }.
 */

import { useQueryClient } from "@tanstack/react-query";

import { createTask, launchTask, getRunConfig, type CopyCommandForms } from "../lib/externalApi";
import type { Project } from "../types";
import type {
  PhaseTask,
  RunConfigResponse,
  RunConfigV2,
} from "../lib/run-config-v2";

export type ContinuePipelineResult =
  | {
      ok: true;
      taskId: string;
      commands: CopyCommandForms;
      copyText: string;
      platform: "windows" | "posix";
      phaseTask: PhaseTask;
      config: RunConfigV2;
    }
  | {
      ok: false;
      reason:
        | "no_run_config"
        | "phase_task_not_found"
        | "phase_task_not_actionable"
        | "phase_task_prereq_not_met"
        | "launch_failed";
      detail?: string;
    };

interface ContinuePipelineArgs {
  project: Project;
  /** When omitted, the first ready phase_task is selected. */
  phaseTaskId?: string;
}

function detectPlatform(): "windows" | "posix" {
  if (typeof navigator === "undefined") return "posix";
  return /win/i.test(navigator.userAgent || "") ? "windows" : "posix";
}

function pickCommand(
  commands: CopyCommandForms,
  platform: "windows" | "posix",
): string {
  return platform === "windows" ? commands.powershell : commands.posix;
}

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts.
  if (typeof document === "undefined") return;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Imperative variant — runs without a hook. Lets non-React callers (e.g.
 * server-side renderers, unit tests) drive the same flow. The React hook
 * below is a thin wrapper that injects the QueryClient.
 */
export async function continuePipeline(
  args: ContinuePipelineArgs,
  deps: {
    fetchRunConfig: (projectId: string) => Promise<RunConfigResponse>;
    create: typeof createTask;
    launch: typeof launchTask;
    clipboard?: (text: string) => Promise<void>;
    platform?: "windows" | "posix";
  },
): Promise<ContinuePipelineResult> {
  const cfg = await deps.fetchRunConfig(args.project.id);
  if (cfg.status !== "ok") {
    return { ok: false, reason: "no_run_config", detail: cfg.status };
  }

  const targetId = args.phaseTaskId ?? cfg.readyToLaunchTasks[0]?.phaseTaskId;
  const phaseTask = cfg.config.phase_tasks.find(
    (t) => t.phaseTaskId === targetId,
  );
  if (!phaseTask) {
    return { ok: false, reason: "phase_task_not_found" };
  }
  if (phaseTask.status !== "awaiting_launch") {
    return { ok: false, reason: "phase_task_not_actionable", detail: phaseTask.status };
  }
  const completed = new Set(cfg.config.completed_phase_task_ids);
  if (!phaseTask.prerequisites.every((p) => completed.has(p))) {
    return { ok: false, reason: "phase_task_prereq_not_met" };
  }

  // Lookup-or-create the shadow (server idempotency by phaseTaskId).
  const task = await deps.create({
    title: phaseTask.title,
    cwd: args.project.path,
    projectId: args.project.id,
    phaseTaskId: phaseTask.phaseTaskId,
    runId: cfg.config.runId,
    sessionUuid: phaseTask.sessionUuid,
    parentRunMaster: false,
  });

  let result;
  try {
    result = await deps.launch(task.taskId, {
      phaseTaskRef: { phaseTaskId: phaseTask.phaseTaskId },
    });
  } catch (err) {
    return {
      ok: false,
      reason: "launch_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const platform = deps.platform ?? detectPlatform();
  const copyText = pickCommand(result.commands, platform);
  if (deps.clipboard) {
    await deps.clipboard(copyText);
  } else {
    await writeClipboard(copyText);
  }

  return {
    ok: true,
    taskId: task.taskId,
    commands: result.commands,
    copyText,
    platform,
    phaseTask,
    config: cfg.config,
  };
}

/** React hook — preferred form. Imperative wrapper above is for tests. */
export function useContinuePipeline() {
  const qc = useQueryClient();
  return async function continuePipelineFromHook(
    args: ContinuePipelineArgs,
  ): Promise<ContinuePipelineResult> {
    const result = await continuePipeline(args, {
      fetchRunConfig: async (projectId) => {
        // Force a fresh read — the cached snapshot the menu was rendered
        // from may be 5s stale.
        await qc.invalidateQueries({ queryKey: ["run-config", projectId] });
        return await getRunConfig(projectId);
      },
      create: createTask,
      launch: launchTask,
    });
    if (result.ok) {
      // Side-effects after success: invalidate task lists + cache the new
      // single-task entry so TaskDetail navigation has it warm.
      void qc.invalidateQueries({ queryKey: ["external-tasks"] });
      void qc.invalidateQueries({ queryKey: ["run-config", args.project.id] });
    }
    return result;
  };
}
