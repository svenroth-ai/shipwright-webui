/*
 * external/launch/legacy-fallback-branch.ts — applyLegacyFallbackBranch.
 *
 * Branch 3 (terminal): always returns a populated result. Used when both
 * other branches return null. Emits the pre-iterate shape
 * (--session-id / --resume / --add-dir / --name / --plugin-dir).
 *
 * iterate-2026-05-08 v0.8.8 AC-1 (refined by Iterate L): Resume on
 * `new-plain` BEFORE first JSONL is semantically a FRESH start; with
 * JSONL on disk, `--resume` is the correct shape.
 */

import {
  buildCopyCommands,
  type CopyCommandForms,
} from "../../core/launcher.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { ParsedLaunchBody } from "./parse-body.js";

export function applyLegacyFallbackBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  jsonlObserved: boolean;
}): { commands: CopyCommandForms; taskUpdate: Partial<ExternalTask> } {
  const { task, parsed, jsonlObserved } = args;
  const effectiveResume =
    parsed.resume && (task.actionId !== "new-plain" || jsonlObserved);
  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    resume: effectiveResume,
    pluginDirs: task.pluginDirs,
    title: task.title,
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
  };
  return { commands, taskUpdate };
}
