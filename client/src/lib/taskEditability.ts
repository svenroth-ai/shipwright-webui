/*
 * Task-field editability rule — the single source of truth for which
 * fields the Edit Task dialog (and the PATCH route) may mutate, given a
 * task's lifecycle position.
 *
 * iterate-2026-05-18-edit-task-dialog.
 *
 * The rule: a field that SHAPES THE LAUNCH COMMAND freezes once the task
 * has started; pure routing metadata stays editable in every state.
 *   - description = the first prompt Claude sees
 *   - phase       = drives the slash command
 *   - priority / complexityHint = triage inputs the user set up-front
 * These four freeze once started. `title` / `projectId` / `domain` /
 * `tags` / `blockedBy` are never frozen.
 *
 * `FROZEN_WHEN_STARTED` is a VERBATIM mirror of
 * `server/src/core/task-editability.ts` — server and client are
 * independent npm workspaces (CLAUDE.md DO-NOT guard #7, no cross-package
 * import). Parity is enforced by
 * `server/src/test/task-editability-mirror.test.ts`.
 */
import type { ExternalTask } from "./externalApi";

/**
 * Fields frozen once a task has started. Keep this literal byte-identical
 * to the server mirror — the parity test extracts and compares it.
 */
export const FROZEN_WHEN_STARTED = [
  "description",
  "phase",
  "priority",
  "complexityHint",
] as const;

export type FrozenField = (typeof FROZEN_WHEN_STARTED)[number];

/**
 * A task is "never started" while it sits in the Backlog and has never
 * been launched. A `draft` task that ran and was moved back to the
 * Backlog keeps its `launchedAt` (set by /launch) and its
 * `firstJsonlObservedAt` — it counts as STARTED, so its launch-shaping
 * fields stay frozen.
 */
export function isNeverStarted(
  task: Pick<ExternalTask, "state" | "launchedAt" | "firstJsonlObservedAt">,
): boolean {
  return (
    task.state === "draft" &&
    !task.launchedAt &&
    !task.firstJsonlObservedAt
  );
}

/**
 * True when `field` may be edited given the task's lifecycle position.
 * Never-started → everything editable. Started → only the non-frozen
 * fields (title / projectId / domain / tags / blockedBy).
 */
export function isFieldEditable(
  field: string,
  task: Pick<ExternalTask, "state" | "launchedAt" | "firstJsonlObservedAt">,
): boolean {
  if (isNeverStarted(task)) return true;
  return !(FROZEN_WHEN_STARTED as readonly string[]).includes(field);
}
