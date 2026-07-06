/*
 * cascade-delete-project-tasks.ts —
 * iterate-2026-07-06-project-delete-cascades-tasks.
 *
 * When a project is deleted (DELETE /api/projects/:id) every task that
 * belonged to it must be removed too. Otherwise those tasks keep a dangling
 * projectId and ProjectManager.getAll() perpetually synthesizes a phantom
 * "Unassigned" row for them — one the client can neither clear nor filter,
 * because the dangling id never equals the reserved "unassigned" sentinel
 * (so the row also shows a count of 0). The load-time O26 normalization in
 * sdk-sessions-store.ts only self-heals stale references on the NEXT server
 * restart; this closes the runtime gap.
 *
 * Behaviour mirrors the single-task DELETE cascade in
 * external/tasks/lifecycle.ts: drop the store row, then best-effort clear the
 * scrollback + cell-state snapshot (both may hold secrets — the delete is the
 * authoritative privacy boundary, ADR-068-A1 + ADR-087 MEDIUM-B1). The
 * on-disk Claude JSONL under ~/.claude is NOT touched (webui is a read-only
 * observer of that directory).
 */

import type { SdkSessionsStore } from "./sdk-sessions-store.js";

export interface CascadeDeleteProjectTasksDeps {
  store: SdkSessionsStore;
  scrollbackClearBestEffort?: (taskId: string) => Promise<void>;
  snapshotClearBestEffort?: (taskId: string) => Promise<void>;
}

/**
 * Remove every task whose `projectId === projectId`. Persists once (not
 * per-task) iff at least one task was removed, then runs the best-effort
 * scrollback + snapshot cleanup. Returns the number of tasks removed.
 */
export async function cascadeDeleteProjectTasks(
  projectId: string,
  deps: CascadeDeleteProjectTasksDeps,
): Promise<number> {
  const { store, scrollbackClearBestEffort, snapshotClearBestEffort } = deps;
  const doomed = store.list().filter((t) => t.projectId === projectId);
  if (doomed.length === 0) return 0;

  for (const t of doomed) {
    store.delete(t.taskId);
  }
  await store.persist();

  // Side-file cleanup runs AFTER the authoritative store mutation. Each call
  // is independently best-effort: a failure to clear one task's scrollback
  // must not abort the rest or reject the cascade.
  for (const t of doomed) {
    if (scrollbackClearBestEffort) {
      try {
        await scrollbackClearBestEffort(t.taskId);
      } catch {
        /* best-effort */
      }
    }
    if (snapshotClearBestEffort) {
      try {
        await snapshotClearBestEffort(t.taskId);
      } catch {
        /* best-effort */
      }
    }
  }

  return doomed.length;
}
