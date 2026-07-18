/*
 * jsonl-records.ts — record-boundary + newline-termination primitives for the
 * append-only logs (triage store + outbox, and the events log on the read side).
 *
 * A NEUTRAL LEAF, deliberately: reader and writer both need one agreed answer to
 * "where does a record end?", and parking that in either would cycle them.
 *
 * WHY THIS EXISTS (iterate-2026-07-18-triage-jsonl-record-boundary)
 * ----------------------------------------------------------------
 * TS port of `shared/scripts/lib/jsonl_records.py` (monorepo PR #399). Writers
 * appended a terminated line without checking the file they appended TO was
 * terminated, so an unterminated predecessor put two records on one physical
 * line; the reader then failed `JSON.parse` on the whole line and skipped it,
 * discarding BOTH. On an append-only log, corruption must never read as absence.
 *
 * The two halves:
 *   - `endsWithoutNewline` — the writer-side probe (prevention).
 *   - `splitRecords` / `parseJsonlRecords` / `recordsFromLines` — recovery,
 *     PARTIAL by design: a valid record followed by an unrecoverable fragment
 *     yields the valid record AND the fragment. All-or-nothing recovery would
 *     reproduce the very bug it is meant to fix.
 *
 * This module NEVER logs. Corruption is returned as data; reporting belongs at
 * the command boundary, so background callers, tests and routes all agree.
 *
 * PORT DEVIATIONS from the Python leaf, all deliberate:
 *   1. Python's `read_jsonl_records(path)` is path-based; this reader is
 *      STRING-based (it also serves the `git show` blob path in
 *      `triage-origin.ts`), so it is ported as `parseJsonlRecords(raw)`.
 *      `endsWithoutNewline` stays path-based — the writer probes a file.
 *   2. Python's `JSONDecoder.raw_decode` has no `JSON.parse` equivalent, so the
 *      splitter is NEW code — see `splitRecords` for fast-path / slow-path.
 *   3. Python reads with `errors="surrogateescape"`, round-tripping invalid
 *      UTF-8 so the monorepo repair CLI can quarantine a fragment byte-exact.
 *      TS uses `readFileSync(p, "utf-8")`, which substitutes U+FFFD and is
 *      LOSSY on a truncated multi-byte sequence. Safe ONLY because the WebUI
 *      never writes a recovered record back. If a WebUI repair path is ever
 *      added, this becomes a correctness bug and must be revisited.
 *
 * KNOWN CROSS-LANGUAGE BOUNDARY: Python's default `JSONDecoder` accepts `NaN` /
 * `Infinity` / `-Infinity`; `JSON.parse` rejects them. Verified by probe. The
 * triage record schema carries only strings and null (no float fields), so this
 * is unreachable from the real producers — but it IS a divergence, so such a
 * line degrades to a fragment (safe) rather than throwing.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** One stretch of text on a physical line that could not be decoded. */
export interface CorruptFragment {
  /** 1-based physical line number within the blob. */
  lineNo: number;
  /**
   * The on-disk text apart from the surrounding whitespace the reader strips.
   * Never logged verbatim — callers report its LENGTH only, so arbitrary log
   * contents and control characters cannot reach the server log.
   */
  text: string;
}

/** Tolerant-read outcome: what was recovered, and what could not be. */
export interface RecordRead {
  records: Record<string, unknown>[];
  /**
   * The explicit side channel that keeps corruption from reading as absence.
   * Empty on a clean read.
   */
  corrupt: CorruptFragment[];
}

// Explicitly JSON's whitespace set as CHAR CODES, NOT a unicode-aware test:
// `String.prototype.trim` and Python's `str.isspace` are both unicode-aware and
// would silently accept NBSP / U+000B / U+000C BETWEEN records, diverging from
// every other JSON consumer of the same bytes.
const CH_SPACE = 32;
const CH_TAB = 9;
const CH_CR = 13;
const CH_LF = 10;
const CH_LBRACE = 0x7b; // {
const CH_RBRACE = 0x7d; // }

// Slow-path ceilings (external review, medium/performance). Both degrade to
// "fragment" — a safe, already-tested outcome, never a throw. A real triage
// record is ~370 bytes with at most trivial nesting, so these sit orders of
// magnitude above legitimate input: they bound an adversarial or badly-
// truncated line, they do not shape normal behaviour.
const MAX_DECODE_ATTEMPTS = 1024;
const MAX_RECOVERY_LINE_BYTES = 1_000_000;

function isJsonWs(code: number): boolean {
  return code === CH_SPACE || code === CH_TAB || code === CH_CR || code === CH_LF;
}

function skipJsonWs(line: string, from: number): number {
  let idx = from;
  while (idx < line.length && isJsonWs(line.charCodeAt(idx))) idx += 1;
  return idx;
}

/**
 * `JSON.parse` restricted to plain objects. Returns undefined for invalid JSON
 * AND for valid-but-wrong-shape input (a bare scalar or a top-level array):
 * callers do `raw.event`, so a non-object is a fragment, not a record.
 */
function tryParseObject(candidate: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Decode one JSON object beginning at `start`, by walking candidate end
 * positions at each `}` and letting native `JSON.parse` validate each slice.
 *
 * This is SELF-CORRECTING for braces inside string values: a candidate ending
 * at an in-string `}` is unbalanced and simply fails to parse, so the walk
 * continues. The SHORTEST valid prefix is the correct record boundary, because
 * any shorter prefix ending at `}` is necessarily unbalanced.
 *
 * Deliberately NOT a hand-rolled JSON lexer (external review R2): brace
 * counting with escaped quotes and backslash runs is a classic source of latent
 * bugs, and delegating validation to V8 removes that whole class.
 */
function decodeObjectAt(
  line: string,
  start: number,
): { value: Record<string, unknown>; end: number } | null {
  let attempts = 0;
  for (let i = start; i < line.length; i += 1) {
    if (line.charCodeAt(i) !== CH_RBRACE) continue;
    // Work budget. Each attempt slices AND parses, so an adversarial line is
    // O(candidates x length) on the request thread — and the board read path
    // (triage-compose → readLocalRawLinesSplit) bypasses `readAllItems`' 5 s
    // cache, so a corrupt line re-pays the cost on EVERY poll with nothing ever
    // repairing the file. Python pays one `raw_decode`; the brace walk is the
    // price of not hand-rolling a lexer, so it gets a ceiling.
    attempts += 1;
    if (attempts > MAX_DECODE_ATTEMPTS) return null;
    const value = tryParseObject(line.slice(start, i + 1));
    if (value !== undefined) return { value, end: i + 1 };
  }
  return null;
}

/**
 * Split one physical `line` into records plus the unrecoverable remainder.
 *
 * `remainder` is `""` when the whole line decoded cleanly, otherwise the
 * VERBATIM text from the first byte that could not be decoded to end of line.
 *
 * Contract (mirrors the Python leaf):
 *   - JSON whitespace between records is skipped (space/tab/CR/LF only).
 *   - A blank / whitespace-only line yields `([], "")` — formatting, not
 *     corruption.
 *   - Only JSON objects count as records; a bare scalar is a fragment.
 *   - Recovery is PARTIAL: records decoded before the bad byte are returned.
 *   - A malformed record does NOT resync — the entire rest of the line becomes
 *     the remainder, matching `raw_decode`.
 *
 * Cost: the fast path is a single native `JSON.parse` and covers essentially
 * every real line. The candidate walk runs only on an already-corrupt line,
 * where lines are short and correctness matters more than throughput.
 */
export function splitRecords(line: string): {
  records: Record<string, unknown>[];
  remainder: string;
} {
  const records: Record<string, unknown>[] = [];
  const first = skipJsonWs(line, 0);
  if (first >= line.length) return { records, remainder: "" };

  // Fast path — one clean record per line is the overwhelmingly common case.
  const whole = tryParseObject(line.slice(first));
  if (whole !== undefined) {
    records.push(whole);
    return { records, remainder: "" };
  }

  // Slow path — only reached on a concatenated or damaged line. A line this
  // long is not a triage record by any reading; refuse the walk rather than
  // parse megabytes of candidates on the request thread.
  if (line.length - first > MAX_RECOVERY_LINE_BYTES) {
    return { records, remainder: line.slice(first) };
  }

  let idx = first;
  while (idx < line.length) {
    idx = skipJsonWs(line, idx);
    if (idx >= line.length) break;
    // Only `{` can start a record. Anything else (a bare scalar, an array, or
    // outright garbage) is handed back verbatim.
    if (line.charCodeAt(idx) !== CH_LBRACE) return { records, remainder: line.slice(idx) };
    const decoded = decodeObjectAt(line, idx);
    if (decoded === null) return { records, remainder: line.slice(idx) };
    records.push(decoded.value);
    idx = decoded.end;
  }
  return { records, remainder: "" };
}

/**
 * Tolerantly parse a whole JSONL blob, recovering concatenated records and
 * returning the rest as data.
 *
 * Order is preserved: records recovered from one physical line stay in wire
 * order relative to each other and to surrounding lines, so the store's
 * `(ts, file-order)` status resolution is unaffected.
 *
 * `trim()` here is intentionally the unicode-aware one — it absorbs a trailing
 * CR (CRLF) and mirrors Python's `raw.strip()`, which is also unicode-aware.
 * The strict JSON-whitespace rule applies BETWEEN records, inside
 * `splitRecords`.
 *
 * Line NUMBERING can differ from Python on a file containing a bare CR: this
 * splits on `\n` only, while Python iterates the handle in universal-newline
 * mode and also breaks on a lone `\r`. Resolved RECORDS are unaffected (CR is
 * JSON whitespace, so `splitRecords` skips an interior CR and recovers both
 * sides either way) — only the `lineNo` reported on a `CorruptFragment` shifts.
 * Noted so an operator correlating a WebUI warning against the monorepo repair
 * CLI's output is not misled.
 */
export function parseJsonlRecords(raw: string): RecordRead {
  const records: Record<string, unknown>[] = [];
  const corrupt: CorruptFragment[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const split = splitRecords(line);
    for (const record of split.records) records.push(record);
    if (split.remainder) {
      corrupt.push({ lineNo: i + 1, text: split.remainder });
    }
  }
  return { records, corrupt };
}

/**
 * Record-by-record view over ALREADY-SPLIT physical lines, recovering
 * concatenated records (iterate-2026-07-19-events-reader-recovery).
 *
 * The events-log readers get `Iterable<string>` lines, not a raw blob, and each
 * keeps its own running index for ordering. Yielding per RECORD lets them keep
 * `idx++` unchanged: two records on one line take two consecutive indices,
 * preserving the wire order last-wins projections depend on.
 *
 * `onLine` fires once per NON-BLANK PHYSICAL LINE, so a caller can keep
 * line-based counters (`totalLines` / `skippedLines`) meaning what they always
 * meant while record-based counters move to the yielded values. Blank lines are
 * formatting and are reported to neither.
 */
export function* recordsFromLines(
  lines: Iterable<string>,
  onLine?: (info: { lineNo: number; corrupt: boolean }) => void,
): Generator<Record<string, unknown>> {
  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo += 1;
    const line = rawLine.trim();
    if (!line) continue;
    const split = splitRecords(line);
    if (onLine) onLine({ lineNo, corrupt: split.remainder.length > 0 });
    for (const record of split.records) yield record;
  }
}

/**
 * True iff `path` exists, is non-empty, and its final byte is not `\n`.
 *
 * A missing or zero-byte file is safely appendable and returns false. A file
 * ending `\r\n` ends in `\n` and so counts as already terminated — prefixing
 * another newline would inject a blank line.
 *
 * Reads exactly ONE byte at `size - 1` via a positional `readSync`; it never
 * reads file contents. An O(N) read here would degrade every status flip as the
 * log grows (external review R3).
 *
 * Any error (missing, unreadable, a directory, not seekable) is treated as
 * "safely appendable". This mirrors the Python leaf, which catches OSError
 * broadly and documents that "the append itself will surface any real I/O
 * problem" — accurate here too: a swallowed EACCES is immediately re-raised by
 * `appendFileSync` and mapped to `TriageWriteError` by the existing handler, so
 * no error is lost. Propagating early would diverge from the cross-language
 * contract for no behavioural gain (external review R10, rejected with reason).
 */
export function endsWithoutNewline(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    // Size is taken from the OPEN handle, not a prior `statSync`, so the offset
    // resolves against the same file state we are about to read. Python does
    // `seek(-1, SEEK_END)`, which is inherently live-end-relative; a stat-then-
    // read pair would seek to a STALE offset if a concurrent Python writer
    // truncated or extended the file between the two calls — precisely the
    // window this module documents as its known limitation.
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    const bytesRead = readSync(fd, buf, 0, 1, size - 1);
    // `Buffer.alloc` zero-fills, so a short read would leave `buf[0] === 0`,
    // which is not CH_LF and would wrongly report "unterminated". Treat any
    // short read as safely appendable instead.
    if (bytesRead !== 1) return false;
    return buf[0] !== CH_LF;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
