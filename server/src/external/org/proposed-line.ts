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
 * session id (up to 64 identifier characters) is lead-written, like the decisionKey, and is audited as such.
 *
 * The classification of fenced lines (line vs quote) and the quote split are the
 * mirrored grammar's `fencedParts` / `splitQuote`; this module only decides what
 * to write.
 */

import { createHash } from "node:crypto";

import {
  fencedParts, normalizeLine, foldForCompare, splitQuote, parseSourceRef, firstBullet, daemonTail,
  EVIDENCE_BULLET_RE, QUOTE_PREFIX_RE,
} from "./proposed-grammar.js";
import { decisionKeyOf } from "./proposed-decision-key.js";
import type { ProposedEntry } from "./proposed-entry-format.js";

export const LINE_MAX = 2000;
/** A shared run of this many (folded) characters between a line and a quote counts as a copy. A quote shorter than
 *  this is never guarded: it is too likely to occur in an honest sentence. */
export const QUOTE_GUARD_MIN = 20;

export interface EvidencePointer {
  session: string;
  time: string;
  message: string;
}

export interface ProposalFacts {
  /** The proposed line as the lead wrote it, normalised to one line. */
  original: string;
  /** Folded quote texts (with and without the pointer suffix), used only to refuse a copy. */
  quotes: string[];
  /** The entry's evidence pointer when it has the known shape; `null` otherwise. */
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

/** `null` for an entry without a fence (old marker-less WebUI form): nothing to edit, nothing to strip. */
export function proposalFacts(block: string): ProposalFacts | null {
  const lines = block.split("\n");
  const parts = fencedParts(lines);
  if (parts === null) return null;
  const pointer = parseSourceRef(firstBullet(daemonTail(lines), EVIDENCE_BULLET_RE) || null);
  return {
    original: normalizeLine(parts.proposed.join("\n")),
    // each quote line, plus the whole quote region joined (a sentence can be pasted across two quote lines)
    quotes: [...parts.quotes.flatMap(quoteNeedles), foldForCompare(parts.quotes.map((q) => q.replace(QUOTE_PREFIX_RE, "")).join(" "))].filter((q) => q !== ""),
    evidence: pointer.kind === "known" ? { session: pointer.session, time: pointer.time, message: pointer.message } : null,
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

/** Validate the line the operator saw (edited or not) against the entry's quotes. */
export function checkEditedLine(raw: string, facts: ProposalFacts): LineVerdict {
  const line = normalizeLine(raw);
  if (line === "") return { ok: false, error: "line_empty" };
  if (line.length > LINE_MAX) return { ok: false, error: "line_too_long" };
  if (sharesQuoteRun(line, facts.quotes)) return { ok: false, error: "line_contains_quote" };
  return { ok: true, line };
}

/** The same checks for the line as proposed: an unedited line that repeats a quote (or is empty) needs an edit. */
export function checkOriginalLine(facts: ProposalFacts): LineVerdict {
  return checkEditedLine(facts.original, facts);
}

/** The log block of a fenced entry: header, key marker (identifier keys only), block fingerprint, the line. */
export function toLoggedLineBlock(entry: ProposedEntry, number: number, line: string): string {
  const adr = `ADR-${String(number).padStart(4, "0")}`;
  const key = decisionKeyOf(entry.block);
  const fp = proposalFingerprint(entry.block);
  const marker = key !== null ? `<!-- decisionKey: ${key} -->\n` : "";
  const print = fp !== null ? `<!-- proposal: ${fp} -->\n` : "";
  return `## ${adr} [${entry.timestamp}] ${entry.leadId}\n${marker}${print}\n- ${line}\n\n`;
}

// The EXACT shape `toLoggedLineBlock` writes and nothing else: the fingerprint is read only at its fixed place
// (right after the header and the optional key marker) of a block with nothing after the line. Any other block - a
// pre-W4 whole entry, a body that merely contains such a line somewhere - is not a line block.
const LOGGED_LINE_BLOCK_RE =
  /^## ADR-\d{4,} \[[^\]\n]+\] [^\n]+\n(?:<!-- decisionKey: [^\n]*-->\n)?(?:<!-- proposal: ([0-9a-f]{32}) -->\n)?\n- ([^\n]+)\n\s*$/;

/** The line and fingerprint of a block written by `toLoggedLineBlock`, or `null` for any other shape. */
export function parseLoggedLineBlock(loggedBlock: string): { line: string; fingerprint: string | null } | null {
  const m = LOGGED_LINE_BLOCK_RE.exec(loggedBlock.replace(/\r/g, ""));
  return m ? { line: m[2], fingerprint: m[1] ?? null } : null;
}

export function isEdited(facts: ProposalFacts, finalLine: string): boolean {
  return finalLine !== facts.original;
}
