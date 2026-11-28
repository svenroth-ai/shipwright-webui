/*
 * external/org/decision-residue.ts — is a still-listed proposed entry the SAME proposal that is already in
 * `decision_log.md` (crash residue: the log write happened, the removal did not), or a different proposal that
 * reuses the identity (the lead rewrote it)? Shared by countersign and reject so both judge it by one rule.
 */

import { toLoggedBlock } from "./decisions-lock.js";
import { parseLoggedLineBlock, proposalFingerprint } from "./proposed-line.js";
import { blockForDigest } from "./proposed-grammar.js";

/** Body of a header-delimited block, i.e. everything after its first line. */
function bodyAfterHeader(block: string): string {
  const idx = block.indexOf("\n");
  return idx === -1 ? "" : block.slice(idx + 1);
}

export type ResidueKind = "same" | "different" | "unknown";

/** Is the still-listed block the proposal that is logged? A fenced entry's log holds the line plus a fingerprint of the
 *  proposed block: identity is told apart by that fingerprint. A line block WITHOUT one (the block's fence nonce was too
 *  short to fingerprint) cannot be told either way: `unknown`, which callers treat as "maybe the same" and fail closed,
 *  unless it is body for body the listed entry (an old whole-entry block can have the same shape, e.g. "- x" plus a
 *  "- Note:" item). A log block written before W4 (whole entry) is compared body for body. */
export function residueKind(logged: { block: string; number: number }, listedBlock: string): ResidueKind {
  const line = parseLoggedLineBlock(logged.block);
  if (line !== null && line.fingerprint !== null) {
    return line.fingerprint === proposalFingerprint(listedBlock) ? "same" : "different";
  }
  const whole = wholeEntryKind(logged, listedBlock);
  // A line block without a fingerprint, with or without a note, that is not the same body: fail closed.
  return whole === "different" && line !== null ? "unknown" : whole;
}

function wholeEntryKind(logged: { block: string; number: number }, listedBlock: string): "same" | "different" {
  // line endings, BOM and trailing blanks are not content (an editor or autocrlf may have rewritten the file)
  const norm = (s: string) => blockForDigest(bodyAfterHeader(s));
  const expected = norm(toLoggedBlock(listedBlock, logged.number));
  const actual = norm(logged.block);
  // Exact match first (a lead's own body may end in a "- Note:" line); then the same body plus the operator's
  // countersign note, the one suffix `withLoggedNote` appends after the COMPLETE original body.
  if (actual === expected) return "same";
  const notePrefix = `${expected}\n\n- Note: `;
  return actual.startsWith(notePrefix) && !actual.slice(notePrefix.length).includes("\n") ? "same" : "different";
}

export const isCrashResidue = (logged: { block: string; number: number }, listedBlock: string): boolean => residueKind(logged, listedBlock) === "same";
