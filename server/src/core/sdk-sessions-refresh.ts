/*
 * core/sdk-sessions-refresh.ts — FR-04.22/V5 (iterate-2026-09-03-claim-holder-launch),
 * single-row disk refresh for the claim-holder launch gate. Split out of
 * sdk-sessions-merge.ts (one-concern-per-file, mirroring validate/merge/store)
 * once the launch-gate addition pushed that file past the 300-line guideline.
 */

import { ensureFileReady, mergeRow, reReadDisk } from "./sdk-sessions-merge.js";
import type { ExternalTask } from "./sdk-sessions-store.js";

/**
 * `load()` only runs once per process, so a foreign writer (the leadwright
 * daemon claiming/releasing a task) only re-enters memory when THIS instance
 * itself persists — a webui that has persisted nothing since a foreign claim
 * was written would otherwise see no claim at all (the normal case for an
 * idle daemon with no browser open).
 *
 * Merges, via `mergeRow`, rather than overwriting: this instance may hold
 * local, not-yet-persisted changes on the row (e.g. a `firstJsonlObservedAt`
 * patch made moments before /launch) that a raw copy of the disk row would
 * silently discard. Mutates BOTH `sessions` AND `baseline` for this id —
 * never just `sessions` (the single most damaging way to get this wrong):
 * leaving `baseline` stale would make the caller believe it OWNS the
 * freshly-observed field (mem now diverges from a stale base) and write it
 * back to disk on the next arbitrary persist(), long after the foreign
 * writer changed or cleared it — permanently unlaunchable, with no error.
 * `baseline` is set to the DISK row, not the merged result, so the
 * caller's own pending diff (if any) stays visible to that next persist(),
 * exactly as if this call never ran.
 *
 * Acquires `deps.lock` for the read, then releases it before returning —
 * proper-lockfile is not reentrant, so a persist() made right after this
 * returns would ELOCKED if the lock stayed held across the caller's
 * remaining work. Leaves `sessions`/`baseline` untouched (falls back to the
 * current in-memory row) when the id is absent on disk (a locally-created
 * row not yet persisted) or the re-read fails to classify ("corrupt"/
 * "future" — same fail-safe posture as persist()'s own re-read).
 *
 * `deletedSinceBaseline` (doubt-review finding, FR-04.22) — `store.delete()`
 * runs synchronously with no lock, so a concurrent same-process delete (e.g.
 * a DELETE /tasks/:id request racing this launch) can land on `sessions`
 * during this function's own `await reReadDisk`. Without this check, `mem`
 * would then read `undefined` and the disk's still-there row would be
 * written straight back into `sessions`/`baseline`, resurrecting a row the
 * caller just deleted — a whole-row analogue of the per-field guard
 * `mergeSessions()` already applies (`if (deleted.has(id)) continue`). The
 * check is re-read right before the mutation (no `await` between the two),
 * so a delete that lands during `reReadDisk` is still caught.
 */
export async function refreshRowFromDisk(
  deps: {
    existsSync: (p: string) => boolean;
    readFile: (p: string, e: string) => Promise<string>;
    mkdirSync: (p: string, opts?: { recursive: boolean }) => void;
    ensureFile: (p: string) => void;
    lock?: (p: string) => Promise<() => Promise<void>>;
  },
  path: string,
  current: number,
  validate: (id: string, value: unknown, schemaVersion: 1 | 2 | 3 | 4) => ExternalTask | null,
  taskId: string,
  sessions: Map<string, ExternalTask>,
  baseline: Map<string, ExternalTask>,
  deletedSinceBaseline: ReadonlySet<string>,
): Promise<ExternalTask | undefined> {
  ensureFileReady(deps, path);
  const release = deps.lock ? await deps.lock(path) : null;
  try {
    const rr = await reReadDisk(deps, path, current, validate);
    if (deletedSinceBaseline.has(taskId)) return undefined; // delete always wins — mirrors mergeSessions()
    if (rr.kind !== "ok") return sessions.get(taskId);
    const fresh = rr.disk.get(taskId);
    if (!fresh) return sessions.get(taskId);
    const mem = sessions.get(taskId);
    sessions.set(taskId, mem ? mergeRow(baseline.get(taskId), mem, fresh) : structuredClone(fresh));
    baseline.set(taskId, structuredClone(fresh));
    return sessions.get(taskId);
  } finally {
    if (release) await release();
  }
}
