/*
 * external/org/decision-record-evidence.ts — resolves the two decision-record evidence pointers of a proposal
 * (iterate-2026-11-28-decision-record-evidence) against the records THIS WebUI writes:
 *
 *   `rejected:<entry time>/<lead>`  the operator's `- Reason:` in `<leadsRoot>/decisions-rejected.md` (`decisions-rejected.ts`)
 *   `decision:ADR-<n>`              the operator's `- Note:` in `<leadsRoot>/decision_log.md` (`countersign-core.ts`)
 *
 * Producer of the pointer and its quote: leadwright #153, `lib/decision-record-evidence.ts`, which checked the quote
 * against these files when the lead proposed. The readers below are a port of that module and of its helpers
 * (`lib/markdown-blocks.ts`, `lib/decision-log-blocks.ts`, `lib/decision-key-markers.ts` `markerValue`,
 * `lib/evidence-quote.ts`), so the window confirms exactly what the daemon would accept: POSITIONAL reading (item 1 of
 * a rejected block is always the lead's line, whatever it starts with; only item 3 after `- Rejected: ` is a reason),
 * a decision block only in the countersign line shape, and no note when two blocks share an ADR number.
 *
 * Fail closed: the file path is fixed (never built from the pointer), read once through an `O_NOFOLLOW` handle,
 * refused when it is a symlink, not a file, outside leadsRoot or larger than `MAX_RECORD_BYTES`. The operator's words
 * are returned ONLY when the quote is confirmed, so the route is no wider a read than the citation itself.
 * Confirmation is a view-time check: the record may change afterwards.
 */

import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import path from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import { parseSourceRef } from "./proposed-evidence-pointer.js";
import { REJECTED_FILE } from "./decisions-rejected.js";

export const DECISION_LOG_FILE = "decision_log.md";
/** A record larger than this is not read (the window says it could not be checked). */
export const MAX_RECORD_BYTES = 5 * 1024 * 1024;
/** leadwright `lib/evidence-quote.ts`: a quote is at least 24 characters (or all of a shorter text), at most 200. */
export const MIN_QUOTE_CHARS = 24;
export const MAX_QUOTE_CHARS = 200;
/** Transport bound on the quote the route accepts, before flattening; `quoteOccursIn` then enforces MAX_QUOTE_CHARS. */
export const MAX_QUOTE_INPUT_CHARS = 4000;

// ---- port of leadwright lib/markdown-blocks.ts ----

const FENCE_LINE_RE = /^⟦SHIPWRIGHT-FENCE:[0-9a-f]+⟧$/;
const MD_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** The file's lines: BOM removed, trailing whitespace (CR included) removed from every line. */
export function recordLines(text: string): string[] {
  return text.replace(/^﻿/, "").split("\n").map((l) => l.trimEnd());
}

function fenceClose(lines: string[], i: number): number {
  const line = lines[i];
  if (FENCE_LINE_RE.test(line)) return lines.indexOf(line, i + 1);
  const md = MD_FENCE_RE.exec(line);
  if (!md) return -1;
  const opener = md[1];
  for (let j = i + 1; j < lines.length; j++) {
    const run = MD_FENCE_RE.exec(lines[j])?.[1];
    if (run !== undefined && run[0] === opener[0] && run.length >= opener.length && lines[j].trim() === run) return j;
  }
  return -1;
}

/** Indexes of the lines that start a block, skipping every line inside a closed fence. */
function blockStarts(lines: string[], isStart: (line: string) => boolean): number[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const close = fenceClose(lines, i);
    if (close !== -1) i = close;
    else if (isStart(lines[i])) starts.push(i);
  }
  return starts;
}

const MARKER_LINE_RE = /^<!--[ \t]*decisionKey:(.*)-->\r?$/;

function markerValue(line: string): string | undefined {
  const m = MARKER_LINE_RE.exec(line);
  if (!m) return undefined;
  const value = m[1].replace(/^[ \t]+|[ \t]+$/g, "");
  return value.includes("-->") || value.includes("<!--") ? undefined : value;
}

// ---- port of leadwright rejectedReasons (lib/decision-record-evidence.ts) ----

const REJECTED_HEADING_RE = /^## Rejected \[([^\]]+)\] (\S+)$/;
const REASON_PREFIX = "- Reason: ";

/** The operator reasons of every rejected block whose heading is exactly `## Rejected [<ts>] <leadId>`. */
export function rejectedReasons(text: string, ts: string, leadId: string): string[] {
  const lines = recordLines(text);
  const starts = blockStarts(lines, (l) => l.startsWith("## "));
  const reasons: string[] = [];
  starts.forEach((start, n) => {
    const m = REJECTED_HEADING_RE.exec(lines[start]);
    if (m === null || m[1] !== ts || m[2] !== leadId) return;
    const body = lines.slice(start + 1, starts[n + 1] ?? lines.length);
    let j = markerValue(body[0] ?? "") !== undefined ? 1 : 0;
    while (j < body.length && body[j] === "") j++;
    const items: string[] = [];
    while (j < body.length && body[j].startsWith("- ")) items.push(body[j++]);
    // items[0] is the lead's line, items[1] the rejection time; only a third item can be the operator's reason
    const reason = items[2];
    if (reason !== undefined && items[1].startsWith("- Rejected: ") && reason.startsWith(REASON_PREFIX)) reasons.push(reason.slice(REASON_PREFIX.length));
  });
  return reasons;
}

// ---- port of leadwright lib/decision-log-blocks.ts (the note part) ----

const ADR_HEADING_RE = /^## ADR-(\d{1,9}) \[([^\]]+)\] ([a-z0-9][a-z0-9-]*)$/;
const PROPOSAL_MARKER_RE = /^<!--[ \t]*proposal:[ \t]*[0-9a-f]{32}[ \t]*-->$/;
const NOTE_PREFIX = "- Note: ";

const sameAdr = (a: string, b: string): boolean => a.replace(/^0+(?=\d)/, "") === b.replace(/^0+(?=\d)/, "");

/** Every `## ADR-<n> [<ts>] <lead>` block body, in file order. */
function decisionLogBlocks(text: string): { adr: string; body: string[] }[] {
  const lines = recordLines(text);
  const starts = blockStarts(lines, (l) => l.startsWith("## "));
  const blocks: { adr: string; body: string[] }[] = [];
  starts.forEach((start, n) => {
    const m = ADR_HEADING_RE.exec(lines[start]);
    if (m !== null) blocks.push({ adr: m[1], body: lines.slice(start + 1, starts[n + 1] ?? lines.length) });
  });
  return blocks;
}

/** The note of a block in the countersign's exact line shape; `undefined` for any other shape or no note. */
function lineBlockNote(blockBody: string[]): string | undefined {
  const body = [...blockBody];
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  let i = 0;
  const marker = markerValue(body[i] ?? "");
  if (marker !== undefined) {
    try {
      decodeURIComponent(marker);
    } catch {
      return undefined; // leadwright: a marker that cannot be decoded makes the block unreadable
    }
    i++;
  }
  if (PROPOSAL_MARKER_RE.test(body[i] ?? "")) i++;
  if (body[i] !== "") return undefined;
  i++;
  const items = body.slice(i);
  if (items.length === 0 || items.length > 2 || !items.every((l) => l.startsWith("- "))) return undefined;
  if (items.length === 2 && !items[1].startsWith(NOTE_PREFIX)) return undefined;
  const line = items[0].slice(2).trim();
  const note = items.length === 2 ? items[1].slice(NOTE_PREFIX.length).trim() : undefined;
  return line === "" || note === "" ? undefined : note;
}

/** The operator note of the countersigned block `ADR-<adr>`, or `undefined` (none, other shape, or two blocks under one number). */
export function decisionNote(text: string, adr: string): string | undefined {
  const blocks = decisionLogBlocks(text).filter((b) => sameAdr(b.adr, adr));
  return blocks.length === 1 ? lineBlockNote(blocks[0].body) : undefined;
}

// ---- port of leadwright lib/evidence-quote.ts ----

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
// leadwright replaces `<!--` and `-->` with `...` in one left-to-right regex pass; split/join in that order gives the same
// text (the two markers cannot overlap except as `<!-->`, where `<!--` wins in both) and is not an HTML tag filter.
const recordableQuote = (s: string): string => s.replace(/[⟦⟧]/g, "'").split("<!--").join("...").split("-->").join("...");

/** True when `quote` is acceptable evidence from `words` by leadwright's rules (length bounds, occurs in the text). */
export function quoteOccursIn(words: string, quote: string): boolean {
  const shown = flat(recordableQuote(words));
  const q = flat(recordableQuote(quote));
  if (q.length === 0 || q.length < Math.min(MIN_QUOTE_CHARS, shown.length) || q.length > MAX_QUOTE_CHARS) return false;
  return shown.includes(q);
}

// ---- the record read and the resolution ----

export type RecordEvidence =
  | { status: "confirmed"; form: "rejected" | "decision"; file: string; words: string }
  | { status: "quote_not_found" | "no_words"; form: "rejected" | "decision"; file: string }
  | { status: "unreadable"; form: "rejected" | "decision"; file: string; detail: string };

export interface RecordEvidenceDeps {
  leadsRoot: string;
  /** Test seams for the O_NOFOLLOW open and the post-open link check. */
  openSync?: typeof openSync;
  lstatSync?: typeof lstatSync;
}

type ReadResult = { ok: true; text: string } | { ok: false; detail: string };

/** One fixed file under leadsRoot, read through a single no-follow handle (no check-then-use race). */
export function readRecordFile(deps: RecordEvidenceDeps, name: string): ReadResult {
  const open = deps.openSync ?? openSync;
  const absolute = path.join(deps.leadsRoot, name);
  let fd: number;
  try {
    // O_NOFOLLOW refuses a symlink at open (POSIX); O_NONBLOCK keeps a FIFO from blocking until a writer appears (the
    // fstat below then refuses it). Windows has neither flag, so the post-open lstat below must agree (small-file.ts).
    fd = open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "unknown";
    if (code === "ENOENT") return { ok: false, detail: "it does not exist" };
    if (code === "ELOOP") return { ok: false, detail: "it is a symbolic link" };
    return { ok: false, detail: `it cannot be opened (${code})` };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, detail: "it is not a file" };
    if (st.size > MAX_RECORD_BYTES) return { ok: false, detail: "it is too large to check" };
    const link = (deps.lstatSync ?? lstatSync)(absolute, { bigint: true });
    if (link.isSymbolicLink()) return { ok: false, detail: "it is a symbolic link" };
    const opened = fstatSync(fd, { bigint: true });
    if (link.dev !== opened.dev || link.ino !== opened.ino) return { ok: false, detail: "it changed while being opened" };
    if (!realPathGuard(deps.leadsRoot, absolute).ok) return { ok: false, detail: "it resolves outside the leads folder" };
    // bounded read: a file that grew past the cap after the fstat is still refused, never read whole
    const buf = Buffer.alloc(st.size + 1); // one byte more than fstat saw: growth after the fstat is refused
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    if (n > st.size) return { ok: false, detail: "it changed while being read" };
    return { ok: true, text: buf.subarray(0, n).toString("utf8") };
  } catch (err) {
    return { ok: false, detail: `it cannot be read (${(err as NodeJS.ErrnoException)?.code ?? "unknown"})` };
  } finally {
    closeSync(fd);
  }
}

/** `null` when the pointer is not one of the two record forms (the route answers 400). */
export function resolveRecordEvidence(deps: RecordEvidenceDeps, pointer: string, quote: string): RecordEvidence | null {
  const source = parseSourceRef(pointer);
  if (source.kind !== "rejected" && source.kind !== "decision") return null;
  const form = source.kind;
  const file = form === "rejected" ? REJECTED_FILE : DECISION_LOG_FILE;
  const read = readRecordFile(deps, file);
  if (!read.ok) return { status: "unreadable", form, file, detail: read.detail };
  const candidates = form === "rejected" ? rejectedReasons(read.text, source.time, source.lead) : [decisionNote(read.text, source.adr)].filter((n): n is string => n !== undefined);
  if (candidates.length === 0) return { status: "no_words", form, file };
  const words = candidates.find((c) => quoteOccursIn(c, quote));
  return words === undefined ? { status: "quote_not_found", form, file } : { status: "confirmed", form, file, words };
}
