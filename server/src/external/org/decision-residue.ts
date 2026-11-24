/*
 * external/org/decision-residue.ts — is a still-listed proposed entry the SAME proposal that is already in
 * `decision_log.md` (crash residue: the log write happened, the removal did not), or a different proposal that
 * reuses the identity (the lead rewrote it)? Shared by countersign and reject so both judge it by one rule.
 */

import { toLoggedBlock } from "./decisions-lock.js";
import { parseLoggedLineBlock, proposalFingerprint } from "./proposed-line.js";

/** Body of a header-delimited block, i.e. everything after its first line. */
function bodyAfterHeader(block: string): string {
  const idx = block.indexOf("\n");
  return idx === -1 ? "" : block.slice(idx + 1);
}

/** A fenced entry's log holds the line plus a fingerprint of the proposed block: identity is told apart by that
 *  fingerprint. A log block written before W4 (whole entry) is compared body for body. */
export function isCrashResidue(logged: { block: string; number: number }, listedBlock: string): boolean {
  const fingerprint = parseLoggedLineBlock(logged.block)?.fingerprint ?? null;
  if (fingerprint !== null) return fingerprint === proposalFingerprint(listedBlock);
  return bodyAfterHeader(toLoggedBlock(listedBlock, logged.number)).trimEnd() === bodyAfterHeader(logged.block).trimEnd();
}
