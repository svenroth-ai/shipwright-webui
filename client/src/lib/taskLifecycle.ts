/*
 * Task-lifecycle predicates — shared SSoT for the TaskCard and
 * TaskDetailHeader surfaces so the two never drift.
 *
 * iterate-2026-05-17-move-to-backlog (FR-01.32 + FR-01.01 AC-6).
 */
import type { ExternalTask, ExternalTaskState } from "./externalApi";

/**
 * The five "In Progress" task states — launched but not yet `done`.
 * Exactly the states from which the "Move to Backlog" action is offered.
 *
 * Verbatim mirror of `server/src/core/sdk-sessions-store.ts`
 * `BACKLOG_SOURCE_STATES`. The server and client are independent npm
 * workspaces (CLAUDE.md DO-NOT guard #7 — no cross-package import); keep
 * the two tuples in sync.
 */
export const IN_PROGRESS_STATES = [
  "awaiting_external_start",
  "active",
  "idle",
  "jsonl_missing",
  "launch_failed",
] as const satisfies readonly ExternalTaskState[];

/** True when `state` is one of the five In-Progress {@link IN_PROGRESS_STATES}. */
export function isInProgressState(state: ExternalTaskState): boolean {
  return (IN_PROGRESS_STATES as readonly ExternalTaskState[]).includes(state);
}

/**
 * True when the task has been launched at least once and Claude wrote a
 * JSONL transcript for it (`firstJsonlObservedAt` is set).
 *
 * The launch CTA must then be **Resume**, never a fresh **Launch** — a
 * fresh `claude --session-id <uuid>` against an already-used session is
 * rejected by Claude with "Session ID already in use". This is the
 * Resume-vs-Launch rule for a `draft` task that has been moved back to
 * the Backlog after running (FR-01.01 AC-6).
 */
export function hasLaunchedBefore(
  task: Pick<ExternalTask, "firstJsonlObservedAt">,
): boolean {
  return Boolean(task.firstJsonlObservedAt);
}
