/*
 * Client wrapper for the task re-open endpoint
 * (iterate-2026-05-31-reopen-done-task).
 *
 * Counterpart of `moveTaskToBacklog` (externalApi.ts) for the terminal
 * `done` state: re-opens a done task (state → draft), preserving the session
 * so the card then offers Resume. Lands in Backlog by default, or in an
 * explicit target column (board-drag-done-reopen — a Done card dragged /
 * menu-moved OUT of Done). Lives in its own module — externalApi.ts is at its
 * bloat ceiling (see the header note there + prStatusApi.ts precedent). Reuses
 * the exported `httpJson` + `EXTERNAL_API` so the fetch+error envelope stays shared.
 */
import { httpJson, EXTERNAL_API, type ExternalTask } from "./externalApi";
import type { BoardColumn } from "./boardColumnApi";

/**
 * POST /tasks/:id/reopen — done → draft. Returns the updated task.
 *
 * `column` lands the reopened card in a specific board column: the
 * drag / ⋯-menu "Move to…" path OUT of Done passes the drop target so the
 * card stays where the user put it (board-drag-done-reopen). Omitted, the
 * server defaults to Backlog (the ⋯-menu "Reopen" action's historical home).
 */
export async function reopenTask(
  taskId: string,
  column?: BoardColumn,
): Promise<ExternalTask> {
  const { task } = await httpJson<{ task: ExternalTask }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/reopen`,
    column
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column }),
        }
      : { method: "POST" },
  );
  return task;
}
