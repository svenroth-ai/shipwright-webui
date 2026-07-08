/*
 * Shared task ordering — the single home for "how recently was this task
 * modified" so the Task Board columns and the List view order identically.
 * iterate-2026-07-08-board-sort-last-modified.
 *
 * Before this module the definition lived privately inside TaskList.tsx (and a
 * near-duplicate in TaskCard.tsx), so the board and list could drift. Both now
 * import from here — one definition, one comparator, one tiebreak.
 *
 * "Last modified" precedence (best signal first):
 *   1. lastJsonlSeenMtimeMs — live transcript activity (a running/most-recent
 *      session). Already a number; used directly when finite.
 *   2. launchedAt           — launched but no JSONL observed yet (ISO → ms).
 *   3. createdAt            — never launched, e.g. a draft (ISO → ms).
 *   4. 0                    — defensive floor; also the value for any source
 *                            that is malformed / unparseable, so a bad
 *                            timestamp can NEVER poison the comparator.
 */
import type { ExternalTask } from "./externalApi";

/** Fields the ordering actually reads — keeps the helpers usable with any
 *  object that carries the task's timestamps + id (tests, partial rows). */
type SortableTask = Pick<
  ExternalTask,
  "taskId" | "lastJsonlSeenMtimeMs" | "launchedAt" | "createdAt"
>;

/** Parse an ISO-8601 string to epoch-ms, or null when absent / unparseable. */
function isoToMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Canonical "last modified" timestamp (epoch-ms) for a task. Always returns a
 * finite number — every source is normalized and non-finite / unparseable
 * values are skipped, so the descending comparator stays total and stable.
 */
export function taskLastModifiedMs(task: SortableTask): number {
  const mtime = task.lastJsonlSeenMtimeMs;
  if (typeof mtime === "number" && Number.isFinite(mtime)) return mtime;
  return isoToMs(task.launchedAt) ?? isoToMs(task.createdAt) ?? 0;
}

/**
 * Descending comparator — newest activity first. Ties (equal timestamps, common
 * for freshly-created drafts) break by `taskId` ascending via `localeCompare`
 * (string compare — task ids are opaque strings/uuids, NOT numbers), so the
 * order is byte-stable across re-renders and the 2 s board/list poll.
 */
export function compareTasksByLastModifiedDesc(
  a: SortableTask,
  b: SortableTask,
): number {
  const diff = taskLastModifiedMs(b) - taskLastModifiedMs(a);
  if (diff !== 0) return diff;
  return a.taskId.localeCompare(b.taskId);
}

/** Non-mutating sort: returns a new array ordered newest-first. */
export function sortTasksByLastModifiedDesc<T extends SortableTask>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort(compareTasksByLastModifiedDesc);
}
