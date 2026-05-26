/*
 * external/launch/phase-task-branch.ts — applyPhaseTaskBranch.
 *
 * Branch 1 in launch precedence (load-bearing security path): the
 * client passes ONLY the phaseTaskId, server re-reads the project's
 * run-config and verifies the entire phase_task before producing a
 * command. Client never gets to dictate sessionUuid / slashCommand.
 *
 * Returns `null` when `phaseTaskRefRaw === undefined` (no opinion;
 * caller falls through). Otherwise returns either the populated
 * commands+taskUpdate, or an error envelope.
 */

import {
  buildCopyCommands,
  type CopyCommandForms,
} from "../../core/launcher.js";
import {
  buildPhaseTaskName,
  PHASE_TASK_ID_PATTERN,
  SLASH_COMMAND_PATTERN,
  SPLIT_ID_SAFE_PATTERN,
} from "../../types/run-config-v2.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import type { LaunchBranchResult } from "./_helpers.js";

export async function applyPhaseTaskBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
}): Promise<LaunchBranchResult | null> {
  const { task, parsed, getProjectById, runConfigReader } = args;
  if (parsed.phaseTaskRefRaw === undefined) return null;

  if (parsed.actionId) {
    return {
      error: {
        error: "mixed_launch_intents",
        detail: "phaseTaskRef and actionId are mutually exclusive",
      },
      status: 400,
    };
  }
  if (
    !parsed.phaseTaskRefRaw ||
    typeof parsed.phaseTaskRefRaw !== "object" ||
    Array.isArray(parsed.phaseTaskRefRaw)
  ) {
    return {
      error: { error: "invalid_phase_task_ref", detail: "must be an object" },
      status: 400,
    };
  }
  const refPhaseTaskId = (parsed.phaseTaskRefRaw as Record<string, unknown>)
    .phaseTaskId;
  if (
    typeof refPhaseTaskId !== "string" ||
    !PHASE_TASK_ID_PATTERN.test(refPhaseTaskId)
  ) {
    return {
      error: {
        error: "invalid_phase_task_id",
        detail: "must match /^ptk-[0-9a-f]{4,}$/",
      },
      status: 400,
    };
  }
  const project = getProjectById?.(task.projectId);
  if (!project || !project.path) {
    return {
      error: {
        error: "phase_task_requires_project",
        projectId: task.projectId,
      },
      status: 400,
    };
  }
  const cfgRead = await runConfigReader(project.path);
  if (cfgRead.status !== "ok") {
    return {
      error: {
        error: "run_config_unavailable",
        status: cfgRead.status,
        ...(cfgRead.status === "invalid" ? { reason: cfgRead.reason } : {}),
      },
      status: 409,
    };
  }
  const phaseTask = cfgRead.config.phase_tasks.find(
    (t) => t.phaseTaskId === refPhaseTaskId,
  );
  if (!phaseTask) {
    return {
      error: { error: "phase_task_not_found", phaseTaskId: refPhaseTaskId },
      status: 409,
    };
  }
  if (phaseTask.status !== "awaiting_launch") {
    return {
      error: {
        error: "phase_task_not_actionable",
        phaseTaskId: refPhaseTaskId,
        status: phaseTask.status,
      },
      status: 409,
    };
  }
  const completed = new Set(cfgRead.config.completed_phase_task_ids);
  if (!phaseTask.prerequisites.every((p) => completed.has(p))) {
    return {
      error: {
        error: "phase_task_prereq_not_met",
        phaseTaskId: refPhaseTaskId,
        prerequisites: phaseTask.prerequisites,
        completed: cfgRead.config.completed_phase_task_ids,
      },
      status: 409,
    };
  }
  // Defense in depth even though the reader already validated these.
  if (!SLASH_COMMAND_PATTERN.test(phaseTask.slashCommand)) {
    return {
      error: {
        error: "phase_task_corrupt",
        detail: "slashCommand fails strict regex",
      },
      status: 409,
    };
  }
  if (
    phaseTask.splitId !== null &&
    !SPLIT_ID_SAFE_PATTERN.test(phaseTask.splitId)
  ) {
    return {
      error: {
        error: "phase_task_corrupt",
        detail: "splitId contains unsafe characters",
      },
      status: 409,
    };
  }
  // The shadow webui task MUST already carry the phase_task's pre-bound
  // sessionUuid (set at create-task time). Mismatch = either a stale
  // shadow trying to launch the wrong phase or a tampered store.
  if (task.sessionUuid !== phaseTask.sessionUuid) {
    return {
      error: {
        error: "phase_task_session_uuid_mismatch",
        taskSessionUuid: task.sessionUuid,
        phaseTaskSessionUuid: phaseTask.sessionUuid,
      },
      status: 409,
    };
  }
  const derivedName = buildPhaseTaskName({
    runId: cfgRead.config.runId,
    phase: phaseTask.phase,
    splitId: phaseTask.splitId,
  });
  const commands: CopyCommandForms = buildCopyCommands({
    sessionUuid: phaseTask.sessionUuid,
    cwd: task.cwd,
    pluginDirs: task.pluginDirs,
    title: derivedName,
    slashCommand: phaseTask.slashCommand,
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
    phaseTaskId: phaseTask.phaseTaskId,
    runId: cfgRead.config.runId,
    parentRunMaster: false,
    phase: phaseTask.phase,
    phaseLabel: phaseTask.phase,
    title: derivedName,
  };
  return { commands, taskUpdate };
}
