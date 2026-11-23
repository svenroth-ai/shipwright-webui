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
import { ensureDecisionAudit, hasDecisionAudit, leadFolderExists, assertAuditAppendable, type DecisionAuditDeps } from "./decisions-audit.js";

export type RejectOutcome =
  | { status: "rejected" }
  | { status: "already_rejected" }
  | { status: "already_countersigned"; number: number }
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
): Promise<RejectOutcome> {
  const lockFn = deps.withDecisionsLock ?? withDecisionsLock;
  return lockFn(deps, (ctx): RejectOutcome => {
    const proposedRaw = ctx.readProposed();
    const matches = parseProposedEntries(proposedRaw).filter(
      (e) => e.timestamp === timestamp && e.leadId === leadId,
    );
    if (matches.length > 1) return { status: "duplicate_identity", count: matches.length };

    // Logged = countersigned (possibly with the proposed-side removal still
    // pending after a crash): never reject an approved entry.
    const logged = findLoggedEntry(parseLoggedEntries(ctx.readLogged()), timestamp, leadId);
    if (logged) return { status: "already_countersigned", number: logged.number };

    if (matches.length === 0) {
      // Rejected earlier: the audit line is the record that it happened. Its
      // decisionKey is unknown here (the block is gone), so match on the
      // timestamp alone - one lead cannot reuse an entry timestamp for a
      // different rejected proposal without also being a duplicate identity.
      return rejectedEarlier(deps, leadId, timestamp) ? { status: "already_rejected" } : { status: "not_found" };
    }

    const target = matches[0];
    // The record needs the lead's own folder; never create one for a name found in a lead-written file.
    if (!leadFolderExists(deps, leadId)) return { status: "lead_unknown" };
    assertAuditAppendable(deps, leadId);
    ensureDecisionAudit(deps, {
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
    return { status: "rejected" };
  });
}

function rejectedEarlier(deps: DecisionAuditDeps, leadId: string, timestamp: string): boolean {
  return hasDecisionAudit(deps, "decision_rejected", leadId, timestamp, undefined);
}
