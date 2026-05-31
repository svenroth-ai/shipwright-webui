/*
 * Client wrapper for the task re-open endpoint
 * (iterate-2026-05-31-reopen-done-task).
 *
 * Counterpart of `moveTaskToBacklog` (externalApi.ts) for the terminal
 * `done` state: re-opens a done task back to the Backlog (state → draft),
 * preserving the session so the card then offers Resume. Lives in its own
 * module — externalApi.ts is at its bloat ceiling (see the header note
 * there + prStatusApi.ts precedent). Reuses the exported `httpJson` +
 * `EXTERNAL_API` so the fetch+error envelope stays shared.
 */
import { httpJson, EXTERNAL_API, type ExternalTask } from "./externalApi";

/** POST /tasks/:id/reopen — done → draft (Backlog). Returns the updated task. */
export async function reopenTask(taskId: string): Promise<ExternalTask> {
  const { task } = await httpJson<{ task: ExternalTask }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/reopen`,
    { method: "POST" },
  );
  return task;
}
