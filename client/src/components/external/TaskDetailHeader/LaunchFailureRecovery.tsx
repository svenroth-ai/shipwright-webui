/*
 * LaunchFailureRecovery — the task-detail header's launch-failure notice
 * (FR-01.61, A17). Mounted ONLY for a launch_failed / jsonl_missing task, so
 * the header carries the SAME words as the board's task card + campaign card
 * (AC4), plus recovery: Retry re-runs the launch funnel (rule 14 — it does not
 * hand-roll a command), Resume re-enters the pre-bound session (never a fresh
 * Launch once the session-id was consumed — a used `--session-id` is rejected).
 *
 * Isolating the LaunchCoordinator + useLaunchTask hooks here (rather than at the
 * MissionTopRow top level) keeps the header's hook surface unchanged for every
 * non-failure task.
 */

import { useCallback } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useLaunchTask } from "../../../hooks/useLaunchTask";
import { useLaunchCoordinator } from "../../../contexts/LaunchCoordinatorContext";
import { hasLaunchedBefore } from "../../../lib/taskLifecycle";
import { resolveLaunchFailure, watchedJsonlPath } from "../../../lib/launchFailure";
import { LaunchFailureNotice } from "../LaunchFailureNotice";

export function LaunchFailureRecovery({
  task,
  onError,
}: {
  task: ExternalTask;
  onError?: (error: string | null) => void;
}) {
  const launchMut = useLaunchTask();
  const coord = useLaunchCoordinator();
  const failure = resolveLaunchFailure({ source: "task", state: task.state });

  const recover = useCallback(
    async (resume: boolean) => {
      onError?.(null);
      if (launchMut.isPending || coord.pendingLaunch) return;
      try {
        const { commands } = await launchMut.mutateAsync({ taskId: task.taskId, resume });
        coord.dispatchAutoLaunch(commands, resume);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [launchMut, coord, task.taskId, onError],
  );

  if (!failure) return null;
  const launchedBefore = hasLaunchedBefore(task);
  const busy = launchMut.isPending || coord.pendingLaunch !== null;

  return (
    <LaunchFailureNotice
      testId={`task-detail-failure-${task.taskId}`}
      failure={failure}
      path={task.state === "jsonl_missing" ? watchedJsonlPath(task.sessionUuid) : undefined}
      busy={busy}
      actions={{
        // launch_failed: Retry re-runs the funnel (fresh only if the session-id
        // was never consumed; else Resume the existing session).
        retry: { onClick: () => void recover(launchedBefore) },
        resume: { onClick: () => void recover(true) },
      }}
    />
  );
}
