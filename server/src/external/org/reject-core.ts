/*
 * external/org/reject-core.ts — the reject action of a proposed entry
 * (campaign shadow-proposals-webui, W3). Removes EXACTLY ONE entry from
 * `decisions-proposed.md` and leaves one `decision_rejected` audit line,
 * inside the same FR-04.28 lock countersign uses (`decisions-lock.ts`) —
 * the webui writes the proposed file only through this lock.
 *
 * Since iterate-2026-11-28-decision-reject-reason the reject also appends one
 * block (the proposed line, the lead, the time, the operator's reason) to the
 * org-wide `decisions-rejected.md` (`decisions-rejected.ts`), under the same lock.
 *
 * Crash-safe / exactly-once, like countersign: the audit line is written
 * FIRST (durable), the rejected-decisions block second (appended only when no
 * block of this identity is there yet), the proposed-side removal last - so the
 * entry's text is never gone before its block exists. A retry that still
 * finds the entry and finds its audit line only removes the entry; a retry
 * that finds no entry but finds the audit line reports `already_rejected`
 * and writes nothing. A double click is the second case: the second request
 * waits on the lock, then finds the first one's result.
 */

import {
  withDecisionsLock,
  parseProposedEntries,
  parseLoggedEntries,
  findLoggedEntry,
  type DecisionsLockDeps,
} from "./decisions-lock.js";
import { atomicWrite } from "./countersign-core.js";
import { decisionKeyOf } from "./proposed-decision-key.js";
import { blockDigest, checkNoteText, checkEditedLine, proposalFacts, LINE_MAX, type ProposalFacts } from "./proposed-line.js";
import { proposedBodyOf } from "./proposed-entry-format.js";
import { normalizeLine, QUOTE_PREFIX_RE, EVIDENCE_BULLET_RE } from "./proposed-grammar.js";
import { appendRejectedBlock, assertRejectedWritable, resolveRejectedPath, QUOTE_WITHHELD } from "./decisions-rejected.js";
import { residueKind } from "./decision-residue.js";
import { ensureRejectAudit, hasDecisionAudit, leadFolderExists, assertAuditAppendable, type DecisionAuditDeps } from "./decisions-audit.js";

export type RejectOutcome =
  /** `recorded`: this call appended the audit record (false = the identical record was already there, a retry). */
  | { status: "rejected"; recorded: boolean; /** a record with another reason already existed and was reused (`null` = it had none) */ existingReason?: string | null }
  | { status: "entry_changed" }
  /** The reason is longer than NOTE_MAX or repeats a quote of the entry; nothing was written. */
  | { status: "reason_rejected"; error: "reason_too_long" | "reason_contains_quote" }
  | { status: "already_rejected" }
  | { status: "already_countersigned"; number: number }
  /** The entry IS in the log, but its countersign audit record is missing (the audit file failed after the log write). */
  | { status: "audit_pending"; number: number }
  | { status: "not_found" }
  | { status: "lead_unknown" }
  | { status: "duplicate_identity"; count: number };

export interface RejectCoreDeps extends DecisionsLockDeps, DecisionAuditDeps {
  withDecisionsLock?: typeof withDecisionsLock;
}

export async function performReject(
  deps: RejectCoreDeps,
  timestamp: string,
  leadId: string,
  author: string,
  /** The operator's reason as typed (validated here, under the lock, against the entry's quotes); `null` = none. */
  rawReason: string | null,
  /** `blockDigest` of the entry block the operator saw; absent = not checked. */
  seenDigest?: string | null,
): Promise<RejectOutcome> {
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;
  return lockFn(deps, (ctx): RejectOutcome => {
    const proposedRaw = ctx.readProposed();
    const matches = parseProposedEntries(proposedRaw).filter(
      (e) => e.timestamp === timestamp && e.leadId === leadId,
    );
    if (matches.length > 1) return { status: "duplicate_identity", count: matches.length };

    // Logged = countersigned (possibly with the proposed-side removal still pending after a crash): never reject an
    // approved entry. One exception: a still-listed entry that is NOT the logged proposal (the lead rewrote it under
    // the same identity) is a different proposal; rejecting it is the way out of `duplicate_identity`.
    const logged = findLoggedEntry(parseLoggedEntries(ctx.readLogged()), timestamp, leadId);
    if (logged) {
      const listed = matches.length === 1 ? matches[0] : null;
      // `unknown` (a log block that cannot be fingerprinted) is treated like residue: fail closed.
      const kind = listed === null ? null : residueKind(logged, listed.block);
      const different = kind === "different";
      if (listed === null || !different) {
        // Still listed (the same proposal) and its countersign record is missing: say so, never "already countersigned".
        // `unknown` stays "already countersigned": Countersign cannot finish such an entry either, so no false advice.
        if (listed !== null && kind === "same" && !hasDecisionAudit(deps, "decision_countersigned", leadId, timestamp, decisionKeyOf(listed.block))) {
          return { status: "audit_pending", number: logged.number };
        }
        return { status: "already_countersigned", number: logged.number };
      }
      // A different proposal under a logged identity: without a fingerprint nothing proves the operator saw this
      // version, so it is never removed unchecked.
      if (seenDigest == null) return { status: "already_countersigned", number: logged.number };
    }

    if (matches.length === 0) {
      // Rejected earlier: the audit line is the record that it happened. Its
      // decisionKey is unknown here (the block is gone), so match on the
      // timestamp alone - one lead cannot reuse an entry timestamp for a
      // different rejected proposal without also being a duplicate identity.
      return rejectedEarlier(deps, leadId, timestamp) ? { status: "already_rejected" } : { status: "not_found" };
    }

    const target = matches[0];
    // A rejected rewrite of an identity that is already logged: the record says which ADR it is about, so it never
    // reads as a rejection of the approved key (rejectedKeys skips it).
    const supersededAdr = logged ? `ADR-${String(logged.number).padStart(4, "0")}` : undefined;
    if (seenDigest != null && seenDigest !== blockDigest(target.block)) return { status: "entry_changed" };
    // Same rules as an edited line (one line, NOTE_MAX, never a copy of the entry's quotes): the reason is read by leads.
    const facts = proposalFacts(target.block);
    const checked = checkNoteText(rawReason, facts);
    if (!checked.ok) return { status: "reason_rejected", error: checked.error === "too_long" ? "reason_too_long" : "reason_contains_quote" };
    const reason = checked.text;
    // The record needs the lead's own folder; never create one for a name found in a lead-written file.
    if (!leadFolderExists(deps, leadId)) return { status: "lead_unknown" };
    assertAuditAppendable(deps, leadId);
    const rejectedPath = resolveRejectedPath(deps.leadsRoot);
    assertRejectedWritable(rejectedPath);
    // Our own record, or nothing: a matching line the lead wrote itself does not count as the operator's record.
    const audit = ensureRejectAudit(deps, {
      kind: "decision_rejected",
      leadId,
      author,
      entryTimestamp: timestamp,
      decisionKey: decisionKeyOf(target.block),
      reason,
      ...(supersededAdr !== undefined ? { supersededAdr } : {}),
    });
    // The Reason item is always THIS request's validated reason: a reused earlier record's reason is read back from
    // the lead's own audit file (lead-writable) and is never written to the org-wide file as the operator's words.
    appendRejectedBlock(rejectedPath, {
      timestamp,
      leadId,
      decisionKey: decisionKeyOf(target.block),
      text: rejectedText(target.block, facts),
      rejectedAt: (deps.now ?? (() => new Date()))().toISOString(),
      reason,
    });
    atomicWrite(
      ctx.proposedPath,
      proposedRaw.slice(0, target.startIndex) + proposedRaw.slice(target.endIndex),
    );
    return { status: "rejected", recorded: audit.recorded, ...(audit.existingReason !== undefined ? { existingReason: audit.existingReason } : {}) };
  });
}

/** The proposed line for the org-wide rejected file: one line, at most LINE_MAX characters. A fenced line that copies
 *  a quote of the entry (the check countersign applies to an unedited line) is never written: the file is read by every
 *  lead, and a quote is that lead's own evidence. An unfenced (old WebUI form) entry is its body flattened to one line. */
function rejectedText(block: string, facts: ProposalFacts | null): string {
  if (facts === null) {
    // An unfenced body has no quote structure to check against: its quote lines and Evidence bullet are left out.
    const kept = (proposedBodyOf(block) ?? "").split("\n").filter((l) => !QUOTE_PREFIX_RE.test(l) && !EVIDENCE_BULLET_RE.test(l));
    return normalizeLine(kept.join("\n")).slice(0, LINE_MAX);
  }
  // The quote check runs on the exact text that would be written (an over-long line is cut first), so a copy inside
  // the first LINE_MAX characters of a longer line is withheld too.
  const verdict = checkEditedLine(facts.original.slice(0, LINE_MAX), facts);
  if (verdict.ok) return verdict.line;
  return verdict.error === "line_contains_quote" ? QUOTE_WITHHELD : "";
}

function rejectedEarlier(deps: DecisionAuditDeps, leadId: string, timestamp: string): boolean {
  return hasDecisionAudit(deps, "decision_rejected", leadId, timestamp, undefined);
}
