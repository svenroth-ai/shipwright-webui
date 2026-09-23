/*
 * codextender-auth-file-sweep.ts — bounded reclamation of orphaned
 * `codextender-auth-*.tmp` credential files (PR-review round 10, iterate-
 * 2026-09-23; Sven's own decision on the CI-BLOCKed design question).
 *
 * `writeCodextenderAuthTokenFile` (launcher-codextender.ts) writes the
 * Codextender proxy's bearer token to a private `0o600` temp file once per
 * launch; the generated command's cleanup suffix deletes it right after the
 * `claude` invocation exits. If the command is never executed (copied out
 * instead of auto-run), the pty is killed before the suffix runs, or launch
 * fails before a command is ever returned to run, that delete step never
 * fires and the file is stranded — the exact gap the required `PR Review`
 * CI gate BLOCKed twice on. Mirrors `snapshot-tmp-sweep.ts`'s shape (same
 * age-gated, best-effort, injectable-deps design) for the same reason: a
 * live write's own cleanup runs within seconds, so anything older than the
 * cutoff is provably orphaned — no active-task veto needed.
 *
 * Wired into the boot + periodic sweep in index.ts alongside the scrollback
 * and snapshot-tmp sweeps. Unlike those two (scoped to the terminal
 * scrollback dir), this one scans `os.tmpdir()` — where
 * `writeCodextenderAuthTokenFile` actually writes — so `dir` is threaded
 * through for testability rather than hardcoded.
 */

import * as fsAsync from "node:fs/promises";
import * as path from "node:path";

/** Matches `codextender-auth-<uuid>.tmp`. Bounded — ReDoS-safe. */
const CODEXTENDER_AUTH_TMP_RE = /^codextender-auth-[0-9a-fA-F-]{36}\.tmp$/;

/**
 * Default reclamation age (10 min) — deliberately much shorter than
 * `snapshot-tmp-sweep.ts`'s 1h default: this file holds a LIVE credential,
 * not just terminal cell-state, and a normal launch's own cleanup deletes it
 * within seconds of the `claude` invocation exiting.
 */
export const DEFAULT_CODEXTENDER_AUTH_TMP_MAX_AGE_MS = 10 * 60 * 1000;

export interface CodextenderAuthFileSweepDeps {
  readdir: (dir: string) => Promise<string[]>;
  stat: (p: string) => Promise<{ mtimeMs: number }>;
  unlink: (p: string) => Promise<void>;
}

export interface CodextenderAuthFileSweepOpts {
  dir: string;
  /** Reclaim tmp files whose mtime is older than this. Default 10 min. */
  maxAgeMs?: number;
  deps?: Partial<CodextenderAuthFileSweepDeps>;
  /** Injected for tests. Defaults to Date.now. */
  now?: () => number;
  logWarn?: (msg: string) => void;
  logInfo?: (msg: string) => void;
}

export interface CodextenderAuthFileSweepResult {
  /** stale credential files unlinked. */
  deleted: number;
  /** stat/unlink failures (kept going). */
  errors: number;
  /** files younger than the cutoff, left in place (still in use). */
  preserved: number;
}

const defaultDeps: CodextenderAuthFileSweepDeps = {
  readdir: (dir) => fsAsync.readdir(dir),
  stat: (p) => fsAsync.stat(p),
  unlink: (p) => fsAsync.unlink(p),
};

/**
 * Age-gated sweep of orphaned `codextender-auth-*.tmp` credential files.
 * Best-effort: dir-read failure and per-file failures are non-fatal (they
 * log a warn and never throw) — the same posture `sweepOrphanSnapshotTmp`
 * takes, for the same reason (a sweep failure must never crash boot or the
 * periodic timer).
 */
export async function sweepOrphanCodextenderAuthFiles(
  opts: CodextenderAuthFileSweepOpts,
): Promise<CodextenderAuthFileSweepResult> {
  const deps: CodextenderAuthFileSweepDeps = { ...defaultDeps, ...opts.deps };
  const now = opts.now ?? Date.now;
  const logWarn = opts.logWarn ?? ((m) => console.warn(m));
  const logInfo = opts.logInfo ?? ((m) => console.log(m));
  const cutoff = now() - (opts.maxAgeMs ?? DEFAULT_CODEXTENDER_AUTH_TMP_MAX_AGE_MS);
  const result: CodextenderAuthFileSweepResult = { deleted: 0, errors: 0, preserved: 0 };

  let entries: string[];
  try {
    entries = await deps.readdir(opts.dir);
  } catch (err) {
    // ENOENT = dir not created yet (benign). Any other error (EACCES/EPERM/
    // EIO) is a real operational failure that leaves credential files on
    // disk — surface it so the gap stays visible; this function never throws.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(
        `[codextender-auth-sweep] readdir failed (${(err as Error).message}); orphan credential files may persist`,
      );
    }
    return result;
  }

  for (const name of entries) {
    if (!CODEXTENDER_AUTH_TMP_RE.test(name)) continue;
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
      logWarn(`[codextender-auth-sweep] unlink failed for ${name}: ${(err as Error).message}`);
    }
  }

  if (result.deleted > 0 || result.errors > 0) {
    logInfo(
      `[codextender-auth-sweep] orphan sweep: deleted=${result.deleted} errors=${result.errors} preserved=${result.preserved}`,
    );
  }
  return result;
}
