/*
 * external/org/proposed-line.ts — what countersign writes to `decision_log.md`
 * for a fenced (daemon / marker-owned) proposal, and what it tells the audit
 * (campaign shadow-proposals-webui, W4).
 *
 * The log gets ONE line: the proposed line, as the operator edited it or as
 * the lead proposed it. Never the fence, the quotes, the Lead/Evidence bullets
 * or the original wording of an edited line (operator decisions 4 + 5). The
 * only lead-written text besides the line is the decisionKey, and only when it
 * is a plain identifier (`decisionKeyOf`). The line is written as a list item
 * on its own line, so no text of it can ever start a header, marker or fence.
 *
 * Documented limits: a look-alike (homoglyph, paraphrase, translation) of a quote is not detected; the evidence
 * pointer's fields (session id, file project and path, event id; a pointer is at most 1024 characters) are
 * lead-written, like the decisionKey, and are audited as such.
 *
 * The classification of fenced lines (line vs quote) and the quote split are the
 * mirrored grammar's `fencedParts` / `splitQuote`; this module only decides what
 * to write.
 */

import { createHash } from "node:crypto";

import {
  fencedParts, normalizeLine, foldForCompare, splitQuote, parseEvidence, evidenceQuoteForGuard, firstBullet, daemonTail, blockForDigest,
  EVIDENCE_BULLET_RE, QUOTE_PREFIX_RE,
} from "./proposed-grammar.js";
import { decisionKeyOf } from "./proposed-decision-key.js";
import type { SourceRef } from "./proposed-evidence-pointer.js";
import type { ProposedEntry } from "./proposed-entry-format.js";

export const LINE_MAX = 2000;
/** A shared run of this many (folded) characters between a line and a quote counts as a copy. A quote shorter than
 *  this is never guarded: it is too likely to occur in an honest sentence. */
export const QUOTE_GUARD_MIN = 20;

/** The audit's structured evidence pointer (`data.evidence`). The session form keeps its original shape (no `form`
 *  field, so records written before the other forms read the same); the file-line and journal-event forms carry a
 *  `form` discriminator and their DECODED fields. Never the quote. */
export type EvidencePointer =
  | { session: string; time: string; message: string }
  | { form: "file"; project: string; path: string[]; line: number }
  | { form: "event"; id: string };

/** `null` for an unknown source: free text is never copied into the audit. */
export function auditEvidence(s: SourceRef): EvidencePointer | null {
  if (s.kind === "known") return { session: s.session, time: s.time, message: s.message };
  if (s.kind === "file") return { form: "file", project: s.project, path: [...s.path], line: s.line };
  if (s.kind === "event") return { form: "event", id: s.id };
  return null;
}

export interface ProposalFacts {
  /** The proposed line as the lead wrote it, normalised to one line. */
  original: string;
  /** Folded quote texts (with and without the pointer suffix), used only to refuse a copy. */
  quotes: string[];
  /** The entry's evidence pointer when it has a known shape (session, file line, journal event); `null` otherwise. */
  evidence: EvidencePointer | null;
}

function quoteNeedles(raw: string): string[] {
  return [foldForCompare(raw.replace(QUOTE_PREFIX_RE, "")), foldForCompare(splitQuote(raw).text)];
}

const FENCE_NONCE_RE = /^⟦SHIPWRIGHT-FENCE:([0-9a-f]+)⟧\r?$/m;

/** A non-text fingerprint of the proposed block: same identity + different block is told apart from crash
 *  residue by it, since the log keeps no original. It hides the block only because the fence nonce is random:
 *  a block whose nonce is shorter than 128 bits (32 hex) gets NO fingerprint (`null`) and is never trusted as residue. */
export function proposalFingerprint(block: string): string | null {
  const nonce = FENCE_NONCE_RE.exec(block)?.[1];
  if (nonce === undefined || nonce.length < 32) return null;
  return createHash("sha256").update(block.replace(/\r/g, "").trimEnd()).digest("hex").slice(0, 32);
}

/** What a browser sends to say "this is the entry I saw": a digest of the block's text (the same text the client
 *  hashes, see `blockForDigest`). Countersign / reject compare it under the lock, so a lead that rewrote the entry
 *  under the same identity between render and click is caught. Not a secret: change detection only. */
export function blockDigest(block: string): string {
  return createHash("sha256").update(blockForDigest(block), "utf8").digest("hex").slice(0, 32);
}

/** `null` for an entry without a fence (old marker-less WebUI form): nothing to edit, nothing to strip. */
export function proposalFacts(block: string): ProposalFacts | null {
  const lines = block.split("\n");
  const parts = fencedParts(lines);
  if (parts === null) return null;
  const evidenceLine = firstBullet(daemonTail(lines), EVIDENCE_BULLET_RE) || null;
  const { source: pointer } = parseEvidence(evidenceLine);
  // the quote the Evidence line carries, guarded even behind a pointer the reader refuses (never logged or audited)
  const evidenceQuote = evidenceQuoteForGuard(evidenceLine);
  return {
    original: normalizeLine(parts.proposed.join("\n")),
    // each quote line, plus the whole quote region joined (a sentence can be pasted across two quote lines)
    quotes: [
      ...(evidenceQuote === null ? [] : [foldForCompare(evidenceQuote)]),
      ...parts.quotes.flatMap(quoteNeedles),
      foldForCompare(parts.quotes.map((q) => q.replace(QUOTE_PREFIX_RE, "")).join(" ")),
      foldForCompare(parts.quotes.map((q) => splitQuote(q).text).join(" ")), // joined, pointers left out
    ].filter((q) => q !== ""),
    evidence: auditEvidence(pointer),
  };
}

export type LineVerdict = { ok: true; line: string } | { ok: false; error: "line_empty" | "line_too_long" | "line_contains_quote" };

/** True when `line` and any guarded quote share a run of QUOTE_GUARD_MIN or more folded characters. */
function sharesQuoteRun(line: string, quotes: string[]): boolean {
  const folded = foldForCompare(line);
  if (folded.length < QUOTE_GUARD_MIN) return false;
  const grams = new Set<string>();
  for (let i = 0; i + QUOTE_GUARD_MIN <= folded.length; i++) grams.add(folded.slice(i, i + QUOTE_GUARD_MIN));
  return quotes.some((q) => {
    for (let i = 0; i + QUOTE_GUARD_MIN <= q.length; i++) if (grams.has(q.slice(i, i + QUOTE_GUARD_MIN))) return true;
    return false;
  });
}

/** Validate the line the operator saw (edited or not) against the entry's quotes. `max` = the length limit. */
export function checkEditedLine(raw: string, facts: Pick<ProposalFacts, "quotes">, max: number = LINE_MAX): LineVerdict {
  const line = normalizeLine(raw);
  if (line === "") return { ok: false, error: "line_empty" };
  if (line.length > max) return { ok: false, error: "line_too_long" };
  if (sharesQuoteRun(line, facts.quotes)) return { ok: false, error: "line_contains_quote" };
  return { ok: true, line };
}

/** The same checks for the line as proposed: an unedited line that repeats a quote (or is empty) needs an edit. */
export function checkOriginalLine(facts: ProposalFacts): LineVerdict {
  return checkEditedLine(facts.original, facts);
}

/** Max length of an operator's reject reason or countersign note (after normalisation to one line). */
export const NOTE_MAX = 600;

export type NoteVerdict = { ok: true; text: string | null } | { ok: false; error: "too_long" | "contains_quote" };

/** An operator's reject reason or countersign note: optional (absent or blank = `null`), and otherwise the same rules
 *  as an edited line - one line, invisible characters removed, at most NOTE_MAX characters, and never a copy of a
 *  quote of the entry. `facts === null` (an entry without a fence) has no quotes to guard. */
export function checkNoteText(raw: string | null | undefined, facts: Pick<ProposalFacts, "quotes"> | null): NoteVerdict {
  if (raw == null) return { ok: true, text: null };
  const verdict = checkEditedLine(raw, facts ?? { quotes: [] }, NOTE_MAX);
  if (verdict.ok) return { ok: true, text: verdict.line };
  if (verdict.error === "line_empty") return { ok: true, text: null };
  return { ok: false, error: verdict.error === "line_too_long" ? "too_long" : "contains_quote" };
}

/** The `- Note: <text>` item a countersign note adds below the logged line (text already passed `checkNoteText`). */
export const noteItem = (note: string | null | undefined): string => (note == null ? "" : `- Note: ${note}\n`);

/** The log block of a fenced entry: header, key marker (identifier keys only), block fingerprint, the line, and the
 *  operator's note as its own item when there is one. */
export function toLoggedLineBlock(entry: ProposedEntry, number: number, line: string, note: string | null = null): string {
  const adr = `ADR-${String(number).padStart(4, "0")}`;
  const key = decisionKeyOf(entry.block);
  const fp = proposalFingerprint(entry.block);
  const marker = key !== null ? `<!-- decisionKey: ${key} -->\n` : "";
  const print = fp !== null ? `<!-- proposal: ${fp} -->\n` : "";
  return `## ${adr} [${entry.timestamp}] ${entry.leadId}\n${marker}${print}\n- ${line}\n${noteItem(note)}\n`;
}

// The EXACT shape `toLoggedLineBlock` writes and nothing else: the fingerprint is read only at its fixed place
// (right after the header and the optional key marker) of a block with nothing after the line but an optional note item. Any other block - a
// pre-W4 whole entry, a body that merely contains such a line somewhere - is not a line block.
const LOGGED_LINE_BLOCK_RE =
  /^## ADR-\d{4,} \[[^\]\n]+\] [^\n]+\n(?:<!-- decisionKey: [^\n]*-->\n)?(?:<!-- proposal: ([0-9a-f]{32}) -->\n)?\n- ([^\n]+)\n(?:- Note: ([^\n]+)\n)?\s*$/;

/** The line, fingerprint and note of a block written by `toLoggedLineBlock`, or `null` for any other shape. */
export function parseLoggedLineBlock(loggedBlock: string): { line: string; fingerprint: string | null; note: string | null } | null {
  const m = LOGGED_LINE_BLOCK_RE.exec(loggedBlock.replace(/\r/g, ""));
  if (!m) return null;
  return { line: m[2], fingerprint: m[1] ?? null, note: m[3] ?? null };
}

export function isEdited(facts: ProposalFacts, finalLine: string): boolean {
  return finalLine !== facts.original;
}
