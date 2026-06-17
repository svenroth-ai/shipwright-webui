/*
 * Board-column behavior — the single client home for the sticky,
 * user-owned column status. iterate-2026-06-17-board-dnd-status-decouple.
 *
 * The board column is DECOUPLED from the machine-derived session `state`:
 * the board groups by `resolveBoardColumn(task)` =
 * `task.boardColumn ?? deriveBoardColumn(task.state)`, so a task with no
 * explicit override falls back to the historical state→column mapping and
 * a live task can be parked in any column while still offering Resume
 * (the CTA keys off `state`, not the column).
 *
 * Lives in its own module (not externalApi.ts, which is at its bloat
 * ceiling — see the header note there + taskReopenApi.ts precedent). The
 * `BoardColumn` union mirrors `server/src/core/board-column.ts` (DO-NOT
 * guard #7 — the two workspaces don't import each other).
 */
import {
  httpJson,
  EXTERNAL_API,
  type ExternalTask,
  type ExternalTaskState,
} from "./externalApi";

export type BoardColumn = "backlog" | "in_progress" | "done";

/** The three board columns, left→right, for rendering + iteration. */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  "backlog",
  "in_progress",
  "done",
] as const;

/**
 * Fallback column for a task with no explicit `boardColumn` override —
 * verbatim the historical `groupByState` mapping (draft→backlog,
 * done→done, every other liveness state→in_progress). Keeping this exact
 * means "no drag ever performed" reproduces today's board byte-for-byte.
 */
export function deriveBoardColumn(state: ExternalTaskState): BoardColumn {
  if (state === "draft") return "backlog";
  if (state === "done") return "done";
  return "in_progress";
}

/** The effective column: the sticky override wins, else the derived fallback. */
export function resolveBoardColumn(
  task: Pick<ExternalTask, "boardColumn" | "state">,
): BoardColumn {
  return task.boardColumn ?? deriveBoardColumn(task.state);
}

/**
 * POST /tasks/:id/column — set the sticky board-column override ONLY.
 * The server never touches `state` / JSONL / run-config, so this is a pure
 * organizational move. Returns the updated task.
 */
export async function setBoardColumn(
  taskId: string,
  column: BoardColumn,
): Promise<ExternalTask> {
  const { task } = await httpJson<{ task: ExternalTask }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/column`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column }),
    },
  );
  return task;
}
