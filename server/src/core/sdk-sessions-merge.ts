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

import { randomUUID } from "node:crypto";
import { rename as fsRename, unlink as fsUnlink } from "node:fs/promises";

import type { ExternalTask } from "./sdk-sessions-store.js";

/** Rename `code`s that are transient on Windows — retried (CLAUDE.md rule 6). */
const RETRYABLE_RENAME_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

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
 * on-disk state (disk). `deleted` is the set of ids this instance removed since
 * baseline — they are dropped UNCONDITIONALLY (a delete wins over a concurrent
 * instance's poll rewrite; taskIds are random UUIDs, never reused). Returns a
 * fresh map; the inputs are never mutated.
 */
export function mergeSessions(
  baseline: Map<string, ExternalTask>,
  memory: Map<string, ExternalTask>,
  disk: Map<string, ExternalTask>,
  deleted: ReadonlySet<string>,
): Map<string, ExternalTask> {
  const out = new Map<string, ExternalTask>();
  const ids = new Set<string>([...baseline.keys(), ...memory.keys(), ...disk.keys()]);
  for (const id of ids) {
    if (deleted.has(id)) continue; // this instance deleted it → delete always wins
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
      // Not in memory and NOT locally deleted (that set was handled above).
      // A baseline means it vanished from memory some other way — drop only
      // when disk is unchanged; else a foreign row / concurrent edit: keep it.
      if (base && deepEqual(base, dsk)) continue;
      out.set(id, structuredClone(dsk));
    }
  }
  return out;
}

/**
 * Classify + parse the on-disk file for a merge re-read (read-only; never
 * writes a corrupt-aside). Returns null when the bytes are unreadable — corrupt
 * JSON, a non-object root, a malformed `sessions`, or a `schemaVersion` outside
 * the 1..current window (a FUTURE version this build must not downgrade). An
 * empty / whitespace file is a legitimately-empty store (schemaVersion=current,
 * no rows). The caller skips the merge on null and writes its full memory.
 */
export function parseDiskState(
  raw: string,
  current: number,
): { schemaVersion: 1 | 2 | 3 | 4; sessions: Record<string, unknown> } | null {
  if (!raw.trim()) return { schemaVersion: current as 1 | 2 | 3 | 4, sessions: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > current) return null;
  const sessions = (parsed as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== "object") return null;
  return { schemaVersion: v as 1 | 2 | 3 | 4, sessions: sessions as Record<string, unknown> };
}

/**
 * Build the on-disk sessions map for a merge, reusing the store's own row
 * validator (passed in to avoid a store↔merge import cycle). Returns null iff
 * the file was unreadable/future-schema (see parseDiskState) so the caller can
 * skip the merge and preserve its full in-memory state.
 */
export function readDiskMap(
  raw: string,
  current: number,
  validate: (id: string, value: unknown, schemaVersion: 1 | 2 | 3 | 4) => ExternalTask | null,
): Map<string, ExternalTask> | null {
  const parsed = parseDiskState(raw, current);
  if (!parsed) return null;
  const disk = new Map<string, ExternalTask>();
  for (const [id, value] of Object.entries(parsed.sessions)) {
    const task = validate(id, value, parsed.schemaVersion);
    if (task) disk.set(id, task);
  }
  return disk;
}

/**
 * Atomic-rename with a bounded EBUSY/EPERM/EACCES backoff (6 attempts,
 * 50→1600 ms) — mirrors the torn-read budget (CLAUDE.md rule 6) so a transient
 * Windows file lock on the rename target doesn't fail the persist.
 */
async function renameWithRetry(
  rename: (from: string, to: string) => Promise<void>,
  from: string,
  to: string,
): Promise<void> {
  let delay = 50;
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !RETRYABLE_RENAME_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1600);
    }
  }
}

/**
 * Atomic write: stage to a unique `<path>.tmp-*` (a mid-write crash lands there,
 * never truncating the live file) then rename it into place — using the
 * injected `rename`, else the fs default when a lock is held (real fs), with the
 * EBUSY/EPERM/EACCES retry + best-effort temp cleanup. Lock-less test doubles
 * (no injected rename) fall back to an in-place write of the SAME payload.
 */
export async function atomicWriteFile(
  deps: {
    writeFile: (path: string, data: string) => Promise<void>;
    rename?: (from: string, to: string) => Promise<void>;
  },
  path: string,
  data: string,
  hasLock: boolean,
): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await deps.writeFile(tmp, data);
  const doRename = deps.rename ?? (hasLock ? fsRename : undefined);
  if (!doRename) {
    await deps.writeFile(path, data);
    return;
  }
  try {
    await renameWithRetry(doRename, tmp, path);
  } catch (err) {
    try { await fsUnlink(tmp); } catch { /* best-effort temp cleanup */ }
    throw err;
  }
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
