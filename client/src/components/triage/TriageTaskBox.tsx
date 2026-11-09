/*
 * TriageTaskBox — the "In progress" box on a card whose Fix-now task exists
 * (iterate-2026-11-09-triage-fixnow-task): the task title, its live state
 * and a link to open it. Plain text only (titles are user input).
 */

import { Link } from "react-router-dom";

import type { ExternalTask } from "../../lib/externalApi";

export function TriageTaskBox({ itemId, task }: { itemId: string; task: ExternalTask }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-muted-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)]"
      data-testid={`triage-task-box-${itemId}`}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <i className="h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden />
        In progress
      </span>
      <span className="min-w-0 flex-1 truncate" title={task.title}>
        Task <b className="font-semibold">{task.title}</b>
      </span>
      <span
        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-px text-[11px] text-[var(--color-muted)]"
        data-testid={`triage-task-state-${itemId}`}
      >
        {task.state.replace(/_/g, " ")}
      </span>
      <Link
        to={`/tasks/${task.taskId}`}
        className="font-semibold text-[var(--color-primary)] hover:underline"
        data-testid={`triage-task-open-${itemId}`}
      >
        Open task
      </Link>
    </div>
  );
}
