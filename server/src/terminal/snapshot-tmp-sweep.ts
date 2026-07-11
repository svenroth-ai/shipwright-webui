/*
 * snapshot-tmp-sweep.ts — D19 (F26), 2026-07-10.
 *
 * Reclamation of orphaned `<taskId>.snapshot.tmp-*` staging files.
 *
 * SnapshotStore.write() (snapshot-store.ts) stages a snapshot to
 * `<taskId>.snapshot.tmp-<pid>-<ms>-<rand>` then atomically renames it to
 * `<taskId>.snapshot`. If the process exits between writeFile(tmp) and the
 * rename — graceful shutdown fires a fire-and-forget finalize then
 * process.exit WITHOUT awaiting snapshot writes (index.ts shutdown path),
 * or the Windows EBUSY rename budget exhausts — the tmp staging file is
 * stranded with FULL terminal cell-state (possibly secrets), and NO
 * existing cleanup surface matches it:
 *   - the DELETE cascade unlinks the exact `<taskId>.snapshot` path;
 *   - scrollback-store.sweepExpired matches `<taskId>.log(.N)?`;
 *   - the iterate-C boot wipe (boot-wipe.ts) matches `.log*`.
 * So an orphaned tmp leaks to disk indefinitely. These two helpers close
 * the gap and are wired into the boot + 24h periodic sweep in index.ts
 * (sweepOrphanSnapshotTmp) and the task-delete cascade (clearTaskSnapshotTmp).
 *
 * Age-gating (default 1h) is the correctness guard for the periodic sweep:
 * a live write renames its tmp within milliseconds, so any tmp older than
 * the cutoff is provably orphaned — no active-task veto needed. Live
 * `.snapshot` / `.log` files never match the tmp pattern and are always
 * preserved.
 *
 * Both functions are pure over an injectable fs deps object (mirrors
 * boot-wipe.ts) so unit tests can drive them without touching disk;
 * production wires `node:fs/promises`.
 */

import * as fsAsync from "node:fs/promises";
import * as path from "node:path";

/** Matches `<uuid>.snapshot.tmp-...` staging files. Bounded — ReDoS-safe. */
const SNAPSHOT_TMP_RE = /^[0-9a-fA-F-]{36}\.snapshot\.tmp-/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
/** Default reclamation age for the periodic sweep (1h). */
export const DEFAULT_TMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface SnapshotTmpSweepDeps {
  readdir: (dir: string) => Promise<string[]>;
  stat: (p: string) => Promise<{ mtimeMs: number }>;
  unlink: (p: string) => Promise<void>;
}

export interface SnapshotTmpSweepOpts {
  dir: string;
  /** Reclaim tmp files whose mtime is older than this. Default 1h. */
  maxAgeMs?: number;
  deps?: Partial<SnapshotTmpSweepDeps>;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
  logWarn?: (msg: string) => void;
  logInfo?: (msg: string) => void;
}

export interface SnapshotTmpSweepResult {
  /** tmp files unlinked. */
  deleted: number;
  /** stat/unlink failures (kept going). */
  errors: number;
  /** tmp files younger than the cutoff, left in place. */
  preserved: number;
}

const defaultDeps: SnapshotTmpSweepDeps = {
  readdir: (dir) => fsAsync.readdir(dir),
  stat: (p) => fsAsync.stat(p),
  unlink: (p) => fsAsync.unlink(p),
};

/**
 * Age-gated sweep of orphaned `<taskId>.snapshot.tmp-*` staging files.
 * Best-effort: dir-read failure and per-file failures are non-fatal (they
 * log a warn and never throw). Wire into the boot + 24h periodic sweep in
 * index.ts alongside the scrollback sweep.
 */
export async function sweepOrphanSnapshotTmp(
  opts: SnapshotTmpSweepOpts,
): Promise<SnapshotTmpSweepResult> {
  const deps: SnapshotTmpSweepDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? Date.now;
  const logWarn = opts.logWarn ?? ((m) => console.warn(m));
  const logInfo = opts.logInfo ?? ((m) => console.log(m));
  const cutoff = now() - (opts.maxAgeMs ?? DEFAULT_TMP_MAX_AGE_MS);
  const result: SnapshotTmpSweepResult = { deleted: 0, errors: 0, preserved: 0 };

  let entries: string[];
  try {
    entries = await deps.readdir(opts.dir);
  } catch (err) {
    // ENOENT = dir not created yet (benign, pre-first-pty) → silent no-op.
    // Any other error (EACCES/EPERM/EIO) is a REAL operational failure that
    // leaves orphan tmp files (possibly secrets) on disk — surface it so the
    // privacy-cleanup gap stays visible (the call-site `.catch` is only a
    // last-resort guard; this function never throws).
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(
        `[snapshot-tmp] sweep readdir failed (${(err as Error).message}); orphan tmp files may persist`,
      );
    }
    return result;
  }

  for (const name of entries) {
    if (!SNAPSHOT_TMP_RE.test(name)) continue;
    const full = path.join(opts.dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = (await deps.stat(full)).mtimeMs;
    } catch {
      result.errors++;
      continue;
    }
    if (mtimeMs >= cutoff) {
      result.preserved++;
      continue;
    }
    try {
      await deps.unlink(full);
      result.deleted++;
    } catch (err) {
      result.errors++;
      logWarn(
        `[snapshot-tmp] unlink failed for ${name}: ${(err as Error).message}`,
      );
    }
  }

  if (result.deleted > 0 || result.errors > 0) {
    logInfo(
      `[snapshot-tmp] orphan sweep: deleted=${result.deleted} errors=${result.errors} preserved=${result.preserved}`,
    );
  }
  return result;
}

/**
 * Immediately unlink every `<taskId>.snapshot.tmp-*` staging stray for one
 * task — NO age gate. Called from the DELETE cascade so a removed task
 * leaves no snapshot artifacts behind (delete = privacy boundary; the tmp
 * may hold secrets). Best-effort; per-file failures log a warn. Returns the
 * count removed. Silently no-ops on a malformed taskId.
 */
export async function clearTaskSnapshotTmp(opts: {
  dir: string;
  taskId: string;
  deps?: Partial<Pick<SnapshotTmpSweepDeps, "readdir" | "unlink">>;
  logWarn?: (msg: string) => void;
}): Promise<number> {
  if (!UUID_RE.test(opts.taskId)) return 0;
  const readdir = opts.deps?.readdir ?? ((d: string) => fsAsync.readdir(d));
  const unlink = opts.deps?.unlink ?? ((p: string) => fsAsync.unlink(p));
  const logWarn = opts.logWarn ?? ((m) => console.warn(m));
  const prefix = `${opts.taskId}.snapshot.tmp-`;

  let entries: string[];
  try {
    entries = await readdir(opts.dir);
  } catch (err) {
    // ENOENT (dir absent) is benign; any other error is a real failure that
    // may leave this task's tmp strays behind — log it, stay best-effort.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(
        `[snapshot-tmp] clear readdir failed for ${opts.taskId} (${(err as Error).message})`,
      );
    }
    return 0;
  }
  let deleted = 0;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    try {
      await unlink(path.join(opts.dir, name));
      deleted++;
    } catch (err) {
      logWarn(
        `[snapshot-tmp] clear failed for ${name}: ${(err as Error).message}`,
      );
    }
  }
  return deleted;
}
