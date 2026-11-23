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
 * The classification of fenced lines (line vs quote) is the mirrored grammar's
 * `fencedParts`; this module only decides what to write.
 */

import { createHash } from "node:crypto";

import { fencedParts, normalizeLine, parseSourceRef, firstBullet, daemonTail, EVIDENCE_BULLET_RE } from "./proposed-grammar.js";
import { decisionKeyOf } from "./proposed-decision-key.js";
import type { ProposedEntry } from "./proposed-entry-format.js";

export const LINE_MAX = 2000;
/** A quote shorter than this is too likely to occur in an honest sentence to count as copied. */
const QUOTE_GUARD_MIN = 20;

export interface EvidencePointer {
  session: string;
  time: string;
  message: string;
}

export interface ProposalFacts {
  /** The proposed line as the lead wrote it, normalised to one line. */
  original: string;
  /** Normalised quote texts (without the `>`), used only to refuse a copy. */
  quotes: string[];
  /** The entry's evidence pointer when it has the known shape; `null` otherwise. */
  evidence: EvidencePointer | null;
}

const QUOTE_SEP = " — ";
const POINTER_ATTEMPT_RE = /^(?:session\b|[A-Za-z0-9_-]{4,}:\S)/;

/** Texts a pasted quote can show up as: with and without its ` — <pointer>` suffix (the view shows it without). */
function quoteNeedles(raw: string): string[] {
  const body = normalizeLine(raw.replace(/^\s*>[ \t]?/, ""));
  const at = body.lastIndexOf(QUOTE_SEP);
  if (at !== -1 && POINTER_ATTEMPT_RE.test(body.slice(at + QUOTE_SEP.length).trim())) return [body, body.slice(0, at).trim()];
  return [body];
}

/** A non-text fingerprint of the proposed block (the fence nonce is random, so it leaks nothing): same
 *  identity + different block is told apart from crash residue by this, since the log keeps no original. */
export function proposalFingerprint(block: string): string {
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
    quotes: parts.quotes.flatMap(quoteNeedles).filter((q) => q !== ""),
    evidence: pointer.kind === "known" ? { session: pointer.session, time: pointer.time, message: pointer.message } : null,
  };
}

export type LineVerdict = { ok: true; line: string } | { ok: false; error: "line_empty" | "line_too_long" | "line_contains_quote" };

/** Validate the operator's edited line against the entry's quotes. */
export function checkEditedLine(raw: string, facts: ProposalFacts): LineVerdict {
  const line = normalizeLine(raw);
  if (line === "") return { ok: false, error: "line_empty" };
  if (line.length > LINE_MAX) return { ok: false, error: "line_too_long" };
  const lower = line.toLowerCase();
  if (facts.quotes.some((q) => q.length >= QUOTE_GUARD_MIN && lower.includes(q.toLowerCase()))) {
    return { ok: false, error: "line_contains_quote" };
  }
  return { ok: true, line };
}

/** The same checks for the line as proposed: an unedited line that repeats a quote (or is empty) needs an edit. */
export function checkOriginalLine(facts: ProposalFacts): LineVerdict {
  return checkEditedLine(facts.original, facts);
}

/** The log block of a fenced entry: header, key marker (identifier keys only), the line. */
export function toLoggedLineBlock(entry: ProposedEntry, number: number, line: string): string {
  const adr = `ADR-${String(number).padStart(4, "0")}`;
  const key = decisionKeyOf(entry.block);
  const marker = key !== null ? `<!-- decisionKey: ${key} -->\n` : "";
  return `## ${adr} [${entry.timestamp}] ${entry.leadId}\n${marker}<!-- proposal: ${proposalFingerprint(entry.block)} -->\n\n- ${line}\n\n`;
}

/** The line of a block written by `toLoggedLineBlock`, or `null` for any other shape. */
export function loggedLineOf(loggedBlock: string): string | null {
  const m = /^## [^\n]*\n(?:<!--[^\n]*-->\n){0,2}\n- ([^\n]+)\n/.exec(loggedBlock.replace(/\r/g, ""));
  return m ? m[1] : null;
}

/** The fingerprint a block written by `toLoggedLineBlock` carries, or `null` for any other shape. */
export function loggedFingerprintOf(loggedBlock: string): string | null {
  return /^<!-- proposal: ([0-9a-f]{32}) -->$/m.exec(loggedBlock.replace(/\r/g, ""))?.[1] ?? null;
}

export function isEdited(facts: ProposalFacts, finalLine: string): boolean {
  return finalLine !== facts.original;
}
