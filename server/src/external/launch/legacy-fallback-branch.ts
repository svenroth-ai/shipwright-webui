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
import { claimExecutorLaunchOverrides } from "./claim-executor-permissions.js";

export function applyLegacyFallbackBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  jsonlObserved: boolean;
  /**
   * FR-04.22 (iterate-2026-09-06-claim-launch-permission-perimeter) — true
   * only when `checkClaimHolderGate` proved this caller holds the task's
   * CURRENT, unexpired claim (leadwright's stage-2 executor). `undefined`/
   * `false` (every human/manual launch) leaves the command byte-identical
   * to before this field existed — verified by
   * `legacy-fallback-branch.test.ts`'s own "manual launch unchanged"
   * assertion on the produced command STRING, not just a 200 status. A
   * leadwright-created task normally has `actionId` set and is armed
   * through `action-substitution-branch.ts` instead (Stage-1 spec review
   * finding) — this branch still needs the same wiring for a task launched
   * before it ever had an actionId.
   */
  claimAuthorized?: boolean;
}): { commands: CopyCommandForms; taskUpdate: Partial<ExternalTask> } {
  const { task, parsed, jsonlObserved, claimAuthorized } = args;
  const effectiveResume =
    parsed.resume && (task.actionId !== "new-plain" || jsonlObserved);
  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    resume: effectiveResume,
    pluginDirs: task.pluginDirs,
    title: task.title,
    ...(claimAuthorized ? claimExecutorLaunchOverrides() : {}),
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
  };
  return { commands, taskUpdate };
}
