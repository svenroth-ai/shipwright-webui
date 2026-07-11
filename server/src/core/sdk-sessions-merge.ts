/*
 * F08 (D04) — multi-instance 3-way merge for SdkSessionsStore.persist().
 *
 * sdk-sessions.json is shared by every webui server on the machine
 * (registryDir is keyed to os.homedir(), config.ts). persist() re-reads the
 * file UNDER the proper-lockfile critical section and reconciles it via these
 * pure helpers, so a concurrent instance's rows and externally-written daemon
 * claim fields survive: for every shared row only the FIELDS this instance
 * actually changed (baseline → memory) are re-applied on top of the current
 * on-disk row; every other field — including claimToken / claimedBy written
 * out-of-band — is taken from disk. Rows added / deleted by either side
 * reconcile by presence.
 *
 * `ExternalTask` has no `updatedAt`, so a last-writer timestamp tiebreak is
 * impossible. The baseline is a deep-copied snapshot taken at load() and
 * refreshed after each successful persist; comparing baseline → memory is
 * precisely what tells this instance which fields it owns.
 */

import type { ExternalTask } from "./sdk-sessions-store.js";

/** Deep structural equality for JSON-shaped ExternalTask values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ka = Object.keys(ao);
    if (ka.length !== Object.keys(bo).length) return false;
    return ka.every(
      (k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]),
    );
  }
  return false;
}

/** Deep-copy a sessions map so the baseline snapshot can't alias live rows. */
export function cloneSessions(
  sessions: Map<string, ExternalTask>,
): Map<string, ExternalTask> {
  const out = new Map<string, ExternalTask>();
  for (const [id, task] of sessions) out.set(id, structuredClone(task));
  return out;
}

/**
 * Merge this instance's local changes (baseline → memory) onto the current
 * on-disk state (disk). Returns a fresh map; the inputs are never mutated.
 */
export function mergeSessions(
  baseline: Map<string, ExternalTask>,
  memory: Map<string, ExternalTask>,
  disk: Map<string, ExternalTask>,
): Map<string, ExternalTask> {
  const out = new Map<string, ExternalTask>();
  const ids = new Set<string>([...baseline.keys(), ...memory.keys(), ...disk.keys()]);
  for (const id of ids) {
    const base = baseline.get(id);
    const mem = memory.get(id);
    const dsk = disk.get(id);
    if (mem && dsk) {
      out.set(id, mergeRow(base, mem, dsk));
    } else if (mem) {
      // Absent on disk. If this instance never touched it and a baseline
      // exists, another instance deleted it → honor the delete. Otherwise
      // (created here, or locally modified) keep this instance's row.
      if (base && deepEqual(base, mem)) continue;
      out.set(id, structuredClone(mem));
    } else if (dsk) {
      // Not in this instance's memory. A baseline means this instance deleted
      // it: drop it only when disk is unchanged since baseline (a concurrent
      // modification beats the delete). No baseline → a foreign row: keep it.
      if (base && deepEqual(base, dsk)) continue;
      out.set(id, structuredClone(dsk));
    }
  }
  return out;
}

/**
 * Field-level 3-way merge of a row present in both memory and disk. Start from
 * the on-disk row (foreign updates + external claim fields), then re-apply
 * every field this instance actually changed (baseline → memory), including
 * fields it removed.
 */
function mergeRow(
  base: ExternalTask | undefined,
  mem: ExternalTask,
  dsk: ExternalTask,
): ExternalTask {
  const out = structuredClone(dsk) as unknown as Record<string, unknown>;
  const keys = new Set<string>([
    ...Object.keys(mem),
    ...(base ? Object.keys(base) : []),
  ]);
  for (const k of keys) {
    const memVal = (mem as unknown as Record<string, unknown>)[k];
    const baseVal = base ? (base as unknown as Record<string, unknown>)[k] : undefined;
    if (deepEqual(memVal, baseVal)) continue; // this instance did not change it
    if (memVal === undefined) delete out[k];
    else out[k] = structuredClone(memVal);
  }
  return out as unknown as ExternalTask;
}
