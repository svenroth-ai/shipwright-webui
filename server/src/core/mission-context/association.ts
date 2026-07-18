/*
 * core/mission-context/association.ts — THE one guarded association write
 * (CONTRACT §5).
 *
 * Lives outside `sdk-sessions-store.ts` for two reasons: that file is a
 * grandfathered bloat entry that must not grow, and — more usefully — keeping
 * the single lifecycle write in its own module makes it auditable in one place
 * instead of buried among the store's CRUD.
 *
 * Why the write exists at all: `prune_stale_run_pointers` deletes
 * `.shipwright/iterate_active/<uuid>.json` once the worktree is gone, so the
 * bridge that identifies the run is TEMPORARY. If the run_id is not captured
 * while the iterate is observable, a session whose UI was never open during the
 * run can never be resolved again (Review-2 Gemini/GPT called the lazy
 * GET-persist alternative "guaranteed data loss").
 *
 * Why it is ONCE-only, not per-GET:
 *   - a read endpoint that mutates on every poll would churn the store file
 *     roughly once a second per open tab, and
 *   - an existing association is never overwritten, not even by a different
 *     run_id. A task belongs to the first iterate observed running under it;
 *     a later pointer naming a different run means something is wrong upstream,
 *     and silently rewriting history is the wrong way to resolve that.
 */

import type { SdkSessionsStore } from "../sdk-sessions-store.js";
import { isMissionContextAssociation, type MissionContextAssociation } from "./types.js";

/**
 * Idempotent compare-and-set. Returns true ONLY when this call actually set the
 * field — the caller then `await store.persist()`, which takes the
 * proper-lockfile lock and 3-way merges (DO-NOT #6).
 *
 * Returns false (a silent no-op) for an unknown task, an already-associated
 * task, or a malformed association.
 */
export function setMissionContextOnce(
  store: Pick<SdkSessionsStore, "get" | "patch">,
  taskId: string,
  association: MissionContextAssociation,
): boolean {
  const task = store.get(taskId);
  if (!task) return false;
  if (task.missionContext) return false;
  if (!isMissionContextAssociation(association)) return false;
  store.patch(taskId, { missionContext: association });
  return true;
}

/**
 * Roll back an association that was set in memory but FAILED to persist
 * (external code review, openai HIGH, 2026-07-18).
 *
 * Without this the compare-and-set is a trap: `setMissionContextOnce` patches
 * the in-memory task, `persist()` then throws (an ELOCKED from a concurrent
 * instance is the realistic case), and every later poll sees a populated
 * `missionContext` and skips the write forever. The association would never
 * reach disk — reintroducing exactly the pruned-pointer data loss it exists to
 * prevent, while looking healthy in memory.
 *
 * Only reverts when the field still holds the association WE set, so a
 * concurrent writer's value is never clobbered.
 */
export function revertMissionContext(
  store: Pick<SdkSessionsStore, "get" | "patch">,
  taskId: string,
  attempted: MissionContextAssociation,
): void {
  const task = store.get(taskId);
  if (!task?.missionContext) return;
  if (task.missionContext.runId !== attempted.runId) return;
  if (task.missionContext.observedAt !== attempted.observedAt) return;
  store.patch(taskId, { missionContext: undefined });
}
