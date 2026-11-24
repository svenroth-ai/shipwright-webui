/*
 * external/org/reject-core.ts — the reject action of a proposed entry
 * (campaign shadow-proposals-webui, W3). Removes EXACTLY ONE entry from
 * `decisions-proposed.md` and leaves one `decision_rejected` audit line,
 * inside the same FR-04.28 lock countersign uses (`decisions-lock.ts`) —
 * the webui writes the proposed file only through this lock.
 *
 * Crash-safe / exactly-once, like countersign: the audit line is written
 * FIRST (durable), the proposed-side removal second. A retry that still
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
import { blockDigest } from "./proposed-line.js";
import { residueKind } from "./decision-residue.js";
import { ensureRejectAudit, hasDecisionAudit, leadFolderExists, assertAuditAppendable, type DecisionAuditDeps } from "./decisions-audit.js";

export type RejectOutcome =
  /** `recorded`: this call appended the audit record (false = the identical record was already there, a retry). */
  | { status: "rejected"; recorded: boolean; /** a record with another reason already existed and was reused (`null` = it had none) */ existingReason?: string | null }
  | { status: "entry_changed" }
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
  reason: string | null,
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
      const different = listed !== null && residueKind(logged, listed.block) === "different";
      if (listed === null || !different) {
        // Still listed and its countersign record is missing: say so, never "already countersigned".
        if (listed !== null && !hasDecisionAudit(deps, "decision_countersigned", leadId, timestamp, decisionKeyOf(listed.block))) {
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
    if (seenDigest != null && seenDigest !== blockDigest(target.block)) return { status: "entry_changed" };
    // The record needs the lead's own folder; never create one for a name found in a lead-written file.
    if (!leadFolderExists(deps, leadId)) return { status: "lead_unknown" };
    assertAuditAppendable(deps, leadId);
    // Our own record, or nothing: a matching line the lead wrote itself does not count as the operator's record.
    const audit = ensureRejectAudit(deps, {
      kind: "decision_rejected",
      leadId,
      author,
      entryTimestamp: timestamp,
      decisionKey: decisionKeyOf(target.block),
      reason,
    });
    atomicWrite(
      ctx.proposedPath,
      proposedRaw.slice(0, target.startIndex) + proposedRaw.slice(target.endIndex),
    );
    return { status: "rejected", recorded: audit.recorded, ...(audit.existingReason !== undefined ? { existingReason: audit.existingReason } : {}) };
  });
}

function rejectedEarlier(deps: DecisionAuditDeps, leadId: string, timestamp: string): boolean {
  return hasDecisionAudit(deps, "decision_rejected", leadId, timestamp, undefined);
}
