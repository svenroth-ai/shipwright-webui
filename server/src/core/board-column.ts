/*
 * Board-column types — shared by the sdk-sessions store and the
 * POST /tasks/:id/column route. iterate-2026-06-17-board-dnd-status-decouple.
 *
 * `boardColumn` is the sticky, user-owned column status. It is DECOUPLED
 * from the machine-derived session `state`: the board groups by
 * `boardColumn ?? deriveBoardColumn(state)`, so a task with no override
 * falls back to the historical state→column mapping (see the client-side
 * `deriveBoardColumn` in `client/src/lib/boardColumnApi.ts`, kept in sync
 * with this union — DO-NOT guard #7 parity).
 */
export type BoardColumn = "backlog" | "in_progress" | "done";

export function isBoardColumn(v: unknown): v is BoardColumn {
  return v === "backlog" || v === "in_progress" || v === "done";
}
