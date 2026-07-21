/*
 * Low-level disk access for the session-JSONL reader: the torn-read retry
 * envelope, the positional tail read, and the newline scan. Split out of
 * `session-watcher.ts` by iterate-2026-07-21-transcript-positional-tail-read —
 * "how we touch the disk safely" vs. that module's "what we look for".
 *
 * WHY POSITIONAL. `readChunk` used to load the ENTIRE file and then slice, so a
 * bounded-tail request cost an unbounded read. Measured over this project's real
 * corpus (203 transcripts, median 2.6 MB, max 138 MB, 82 % over 1 MB): a full
 * sweep moved 917 MB in 229 ms; the same sweep with a 512 KB positional tail
 * moves 101 MB in 37 ms. Per poll on the largest transcript, 30.9 ms → 0.12 ms.
 * The shape is the point — the old cost was O(file size) and grew for the life
 * of a session, while a positional read is flat.
 *
 * CONCURRENCY CONTRACT, stated precisely because both external reviewers went
 * for it: the read runs through the EOF observed by the OPEN HANDLE's own
 * fstat, not "EOF at completion".
 *   - APPEND mid-read → the new bytes are simply deferred to the next poll.
 *     Safe, because the cursor (`toByte`) always follows what was delivered, so
 *     the caller resumes exactly where the content stopped.
 *   - TRUNCATION mid-read → the read comes up short, and we re-stat so the
 *     caller clamps against the size that actually exists now. That is what
 *     the whole-file reader did implicitly (it clamped against the bytes it
 *     obtained), and reproducing it is what keeps the swap behavior-preserving.
 */

import { open } from "node:fs/promises";

/** The slice of `FileHandle` this module needs — an injection seam for tests. */
export interface TailFileHandle {
  stat(): Promise<{ size: number }>;
  read(
    buf: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export type OpenForRead = (p: string) => Promise<TailFileHandle>;

export interface TailRead {
  /** The bytes of `[from, end)`, where `from` is `fromByte` clamped to `size`. */
  bytes: Buffer;
  /**
   * The size the caller must clamp `fromByte` against — the effective readable
   * end THIS read observed. Normally the opening fstat; after a short read, the
   * re-stat'ed (smaller) size, so a file truncated under us cannot leave the
   * caller's cursor stranded past the new EOF.
   */
  size: number;
}

const openForReadOnly: OpenForRead = (p) => open(p, "r");

/**
 * Read `[fromByte, EOF)` of `p`. Reads only what was asked for — the whole
 * point of this module. `fromByte` is clamped into `[0, size]`.
 */
export async function readTailFromDisk(
  p: string,
  fromByte: number,
  openForRead: OpenForRead = openForReadOnly,
): Promise<TailRead> {
  const fh = await openForRead(p);
  try {
    const { size } = await fh.stat();
    const start = Math.min(Math.max(fromByte, 0), size);
    const length = size - start;
    if (length <= 0) return { bytes: Buffer.alloc(0), size };

    // allocUnsafe, deliberately: every byte in [0, off) is written by the loop
    // below and ONLY that region is ever returned, so no uninitialised memory
    // can escape. Buffer.alloc would add a full-length memset to the
    // `fromByte: 0` callers, which legitimately read whole 100 MB+ files.
    const buf = Buffer.allocUnsafe(length);
    let off = 0;
    while (off < length) {
      const { bytesRead } = await fh.read(buf, off, length - off, start + off);
      if (bytesRead === 0) break; // EOF — the file shrank under us
      off += bytesRead;
    }
    if (off === length) return { bytes: buf, size };

    // Short read ⇒ truncation. Re-stat so the caller clamps against what exists
    // now; never let the re-stat INFLATE the clamp past what this read covered.
    let effective = size;
    try {
      effective = Math.min(size, (await fh.stat()).size);
    } catch {
      /* keep the opening size — a failed re-stat must not lose the bytes we did read */
    }
    // The bytes in hand live at `start`. Reporting a smaller `size` makes the
    // caller clamp `from` DOWN to it, so anything past the new end would be
    // handed back under an offset it never occupied. Drop it instead of
    // relabelling it: the whole-file reader, clamping `from` against the
    // shrunken length it read, delivered exactly this much and no more.
    const deliverable = Math.max(0, Math.min(off, effective - start));
    return { bytes: buf.subarray(0, deliverable), size: effective };
  } finally {
    try {
      await fh.close();
    } catch {
      /*
       * A close failure must never replace the real I/O error: `readWithRetry`
       * classifies on `err.code`, so surfacing EPERM-from-close instead of the
       * actual read error would change RETRY behavior, not merely the message.
       * On a read-only handle a close error is not actionable either way.
       */
    }
  }
}

// ---------- torn-read retry (moved verbatim from session-watcher.ts) ----------

const RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600];
const RETRY_ERROR_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOENT"]);
/** D06/F24 — discovery passes this so ENOENT (absent) is an authoritative miss. */
export const ENOENT_FATAL: ReadonlySet<string> = new Set(["ENOENT"]);

/** 6-attempt exponential backoff over Windows fs errors; `fatalCodes` bails
 * immediately on the given codes (e.g. ENOENT for discovery). */
export async function readWithRetry<T>(
  op: () => Promise<T>,
  fatalCodes?: ReadonlySet<string>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (!code || !RETRY_ERROR_CODES.has(code) || fatalCodes?.has(code)) {
        throw err; // non-retryable (permissions, syntax) or caller-fatal
      }
      if (i === RETRY_DELAYS_MS.length - 1) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  throw lastErr;
}

/** Index of the last `byte` in `buf`, or -1. */
export function lastIndexOfByte(buf: Buffer, byte: number): number {
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] === byte) return i;
  }
  return -1;
}
