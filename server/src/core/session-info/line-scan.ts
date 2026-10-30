/*
 * Bounded, read-only, line-oriented scan of a (possibly 100 MB+) session JSONL.
 *
 * Reads the NEWEST `maxBytes` of the file in fixed-size POSITIONAL chunks via
 * the same open/stat/read shape as `session-jsonl-io.ts` (never a whole-file
 * read — CLAUDE.md rule 6) wrapped in its `readWithRetry` torn-read envelope.
 * Lines are cut on 0x0A only and decoded per line, so a multi-byte character
 * can never be split across a chunk (rule 5). When the window starts mid-line
 * the first (partial) line is dropped; a record above MAX_LINE_BYTES is skipped
 * undecoded (huge tool results hold none of the facts we collect).
 */

import { open } from "node:fs/promises";

import { ENOENT_FATAL, readWithRetry, type OpenForRead } from "../session-jsonl-io.js";

export const SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface ScanOptions {
  chunkBytes?: number;
  maxLineBytes?: number;
  openForRead?: OpenForRead;
}

export interface LineScanResult {
  /** Window began after byte 0 — older history was not seen. */
  truncated: boolean;
  scannedBytes: number;
  sizeBytes: number;
}

const openReadOnly: OpenForRead = (p) => open(p, "r");

export async function scanLines(
  filePath: string,
  maxBytes: number,
  onLine: (line: string) => void,
  opts: ScanOptions = {},
): Promise<LineScanResult> {
  const chunkBytes = opts.chunkBytes ?? SCAN_CHUNK_BYTES;
  const maxLine = opts.maxLineBytes ?? MAX_LINE_BYTES;
  const openForRead = opts.openForRead ?? openReadOnly;
  // The file was just located, so ENOENT means "gone": fail fast instead of burning the ~3 s retry budget.
  return readWithRetry(async () => {
    const fh = await openForRead(filePath);
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - maxBytes);
      let pos = start;
      let carry: Buffer = Buffer.alloc(0);
      // Drop the first line only when the window really begins mid-line.
      let dropFirst = false;
      if (start > 0) {
        const prev = Buffer.alloc(1);
        const { bytesRead } = await fh.read(prev, 0, 1, start - 1);
        dropFirst = bytesRead === 1 && prev[0] !== 0x0a;
      }
      let skipping = false; // inside an over-long line
      while (pos < size) {
        const len = Math.min(chunkBytes, size - pos);
        const buf = Buffer.allocUnsafe(len);
        let off = 0;
        while (off < len) {
          const { bytesRead } = await fh.read(buf, off, len - off, pos + off);
          if (bytesRead === 0) break;
          off += bytesRead;
        }
        if (off === 0) break; // file shrank under us
        pos += off;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, off)]) : buf.subarray(0, off);
        let lineStart = 0;
        for (let i = data.indexOf(0x0a); i !== -1; i = data.indexOf(0x0a, lineStart)) {
          if (dropFirst) dropFirst = false;
          else if (skipping) skipping = false;
          else if (i > lineStart && i - lineStart <= maxLine) onLine(data.toString("utf8", lineStart, i));
          lineStart = i + 1;
        }
        carry = Buffer.from(data.subarray(lineStart));
        if (carry.length > maxLine) {
          carry = Buffer.alloc(0);
          if (!dropFirst) skipping = true;
        }
      }
      // Final line without a trailing newline (a live session mid-write may
      // leave a torn one — JSON.parse failure is the consumer's concern).
      if (!dropFirst && !skipping && carry.length) onLine(carry.toString("utf8"));
      return { truncated: start > 0, scannedBytes: Math.min(size, maxBytes), sizeBytes: size };
    } finally {
      try {
        await fh.close();
      } catch {
        /* a close failure must not mask the real I/O error (see session-jsonl-io.ts) */
      }
    }
  }, ENOENT_FATAL);
}

/** First line of the file (≤ `headBytes`), for the start timestamp when the scan window skipped it. */
export async function readFirstLine(
  filePath: string,
  headBytes = 256 * 1024,
  openForRead: OpenForRead = openReadOnly,
): Promise<string | null> {
  return readWithRetry(async () => {
    const fh = await openForRead(filePath);
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, headBytes);
      if (len <= 0) return null;
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      const nl = buf.subarray(0, bytesRead).indexOf(0x0a);
      return buf.toString("utf8", 0, nl === -1 ? bytesRead : nl);
    } finally {
      try {
        await fh.close();
      } catch {
        /* see above */
      }
    }
  }, ENOENT_FATAL);
}
