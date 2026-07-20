/*
 * core/mission-context/fs-read.ts — ATOMIC bounded file read.
 *
 * Closes a genuine TOCTOU (CodeQL `js/file-system-race`, 4 HIGH alerts on the
 * S1 PR). Every reader in this module previously did:
 *
 *     const st = statSync(path);          // check
 *     if (st.size > CAP) return null;
 *     return readFileSync(path, "utf-8"); // …then re-open by PATH
 *
 * Between the check and the read the path can be swapped, so the size cap was
 * advisory: a file that statted small could be read large. The mtime used for
 * cache keys had the same gap — it could describe a different file than the
 * bytes actually returned.
 *
 * The fix is to open ONCE and answer every question from that single
 * descriptor: `fstatSync(fd)` describes exactly the bytes `readFileSync(fd)`
 * returns, so size, mtime and content can no longer disagree.
 */

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";

export interface BoundedRead {
  text: string;
  /** mtime of the bytes actually read — safe to use as a cache key. */
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Read `absolute` as UTF-8, refusing anything larger than `maxBytes`.
 *
 * Returns null for: missing, unreadable, not-a-regular-file, or over the cap.
 * The caller distinguishes those cases by its own prior checks — this function
 * deliberately collapses them, because from the reader's point of view they are
 * all "no usable content".
 *
 * The path MUST already have passed pathGuard + realPathGuard; this closes the
 * size/mtime race, it is not a substitute for the traversal guards.
 */
export function readBoundedFile(absolute: string, maxBytes: number): BoundedRead | null {
  let fd: number | undefined;
  try {
    fd = openSync(absolute, "r");
    const st = fstatSync(fd);
    // A directory or device would otherwise read as garbage / block.
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return null;
    // Reading FROM THE DESCRIPTOR is the load-bearing part: the bytes cannot
    // belong to a different file than the one just fstat-ed.
    const text = readFileSync(fd, "utf-8");
    return { text, mtimeMs: st.mtimeMs, sizeBytes: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed / invalid — nothing useful to do */
      }
    }
  }
}

export type BoundedReadOrUnchanged =
  | { changed: true; text: string; mtimeMs: number; sizeBytes: number }
  | { changed: false; mtimeMs: number; sizeBytes: number };

/**
 * Open ONCE; `fstat`; if `(mtimeMs, sizeBytes)` still matches `known`, return
 * WITHOUT reading the bytes (`changed: false`); otherwise read them
 * (`changed: true`).
 *
 * This lets an mtime-keyed cache skip re-reading (and re-parsing) a large file
 * that has not moved, while keeping the same single-descriptor discipline as
 * `readBoundedFile`: the fstat that decides "unchanged" and the read that
 * follows a change both come from the ONE fd, so there is no stat-then-read path
 * race to reintroduce the TOCTOU that `fs-read.ts` exists to close (CodeQL
 * js/file-system-race). Returns null on the same "no usable content" cases.
 *
 * The path MUST already have passed pathGuard + realPathGuard.
 */
export function readBoundedFileIfChanged(
  absolute: string,
  maxBytes: number,
  known: { mtimeMs: number; sizeBytes: number } | null,
): BoundedReadOrUnchanged | null {
  let fd: number | undefined;
  try {
    fd = openSync(absolute, "r");
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return null;
    if (known && known.mtimeMs === st.mtimeMs && known.sizeBytes === st.size) {
      return { changed: false, mtimeMs: st.mtimeMs, sizeBytes: st.size };
    }
    const text = readFileSync(fd, "utf-8");
    return { changed: true, text, mtimeMs: st.mtimeMs, sizeBytes: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* already closed / invalid — nothing useful to do */
      }
    }
  }
}
