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

/** fs error `code`s that are transient on Windows — retried (CLAUDE.md rule 6). */
const RETRYABLE_FS_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

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

export type DiskReadResult =
  | { kind: "ok"; disk: Map<string, ExternalTask> }
  | { kind: "corrupt" } // salvageably-empty: unparseable bytes hold no foreign rows
  | { kind: "future" }; // a NEWER instance's file — never downgrade/overwrite it

/**
 * Classify the on-disk bytes for a merge re-read (pure; no side effects). Empty
 * / whitespace is a legitimately-empty store. Corrupt = unparseable JSON, a
 * non-object root, a malformed `sessions`, or a non-integer / < 1 schemaVersion.
 * Future = valid JSON whose integer schemaVersion is GREATER than this build's.
 */
export function classifyDiskRaw(
  raw: string,
  current: number,
):
  | { kind: "ok"; schemaVersion: 1 | 2 | 3 | 4; sessions: Record<string, unknown> }
  | { kind: "corrupt" }
  | { kind: "future" } {
  if (!raw.trim()) return { kind: "ok", schemaVersion: current as 1 | 2 | 3 | 4, sessions: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "corrupt" };
  const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { kind: "corrupt" };
  if (v > current) return { kind: "future" };
  const sessions = (parsed as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== "object") return { kind: "corrupt" };
  return { kind: "ok", schemaVersion: v as 1 | 2 | 3 | 4, sessions: sessions as Record<string, unknown> };
}

/** Retry a transient (EBUSY/EPERM/EACCES) fs op up to 6× with 50→1600 ms backoff. */
async function withFsRetry<T>(op: () => Promise<T>): Promise<T> {
  let delay = 50;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !RETRYABLE_FS_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 1600);
    }
  }
}

/**
 * Re-read + classify + validate the on-disk file for a persist merge. A missing
 * file / ENOENT is an empty store; a TRANSIENT read error (EBUSY/EPERM/EACCES)
 * is retried, then re-thrown (the caller must reject, NOT full-write — that
 * would clobber a concurrent instance's rows). Returns "corrupt"/"future" for
 * the caller to recover / abort. Reuses the store's row validator (injected to
 * avoid a store↔merge import cycle).
 */
export async function reReadDisk(
  deps: { existsSync: (p: string) => boolean; readFile: (p: string, e: string) => Promise<string> },
  path: string,
  current: number,
  validate: (id: string, value: unknown, schemaVersion: 1 | 2 | 3 | 4) => ExternalTask | null,
): Promise<DiskReadResult> {
  const raw = deps.existsSync(path)
    ? await withFsRetry(() =>
        deps.readFile(path, "utf-8").catch((err: NodeJS.ErrnoException) => {
          if (err?.code === "ENOENT") return ""; // vanished mid-flight → empty store
          throw err;
        }),
      )
    : "";
  const cls = classifyDiskRaw(raw, current);
  if (cls.kind !== "ok") return cls;
  const disk = new Map<string, ExternalTask>();
  for (const [id, value] of Object.entries(cls.sessions)) {
    const task = validate(id, value, cls.schemaVersion);
    if (task) disk.set(id, task);
  }
  return { kind: "ok", disk };
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
  await withFsRetry(() => rename(from, to));
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
