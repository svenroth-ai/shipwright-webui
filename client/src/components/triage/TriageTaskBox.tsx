/*
 * TriageTaskBox — the "In progress" box on a row whose Fix-now task exists
 * (iterate-2026-11-09-triage-fixnow-task): the task's live state and a link to
 * open it. The task title is NOT repeated here (it only echoed the item's own
 * title; iterate-2026-11-13-triage-rows-round3) — it stays in the tooltip.
 * Plain text only (titles are user input).
 */

import { Link } from "react-router-dom";

import type { ExternalTask } from "../../lib/externalApi";

export function TriageTaskBox({ itemId, task }: { itemId: string; task: ExternalTask }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-xs text-white/90"
      data-testid={`triage-task-box-${itemId}`}
      title={task.title}
    >
      <span className="inline-flex flex-1 items-center gap-1.5 font-semibold">
        <i className="h-2 w-2 rounded-full bg-[var(--ok-solid,var(--ok))]" aria-hidden />
        In progress
      </span>
      <span
        className="rounded-full border border-white/20 bg-white/10 px-2 py-px text-xs text-white"
        data-testid={`triage-task-state-${itemId}`}
      >
        {task.state.replace(/_/g, " ")}
      </span>
      <Link
        to={`/tasks/${task.taskId}`}
        className="font-semibold text-[var(--ok-solid,var(--ok))] hover:underline"
        data-testid={`triage-task-open-${itemId}`}
      >
        Open task
      </Link>
    </div>
  );
}
