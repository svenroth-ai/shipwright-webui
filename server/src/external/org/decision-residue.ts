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
 *  short to fingerprint) cannot be told either way: `unknown`, which callers treat as "maybe the same" and fail closed.
 *  A log block written before W4 (whole entry) is compared body for body. */
export function residueKind(logged: { block: string; number: number }, listedBlock: string): ResidueKind {
  const line = parseLoggedLineBlock(logged.block);
  if (line !== null) {
    if (line.fingerprint === null) return "unknown";
    return line.fingerprint === proposalFingerprint(listedBlock) ? "same" : "different";
  }
  // line endings, BOM and trailing blanks are not content (an editor or autocrlf may have rewritten the file)
  const norm = (s: string) => blockForDigest(bodyAfterHeader(s));
  return norm(toLoggedBlock(listedBlock, logged.number)) === norm(logged.block) ? "same" : "different";
}

export const isCrashResidue = (logged: { block: string; number: number }, listedBlock: string): boolean => residueKind(logged, listedBlock) === "same";
