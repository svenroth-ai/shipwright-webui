/*
 * external/org/beat-register-release-audit.ts — the `beat_recovered`
 * audit-append half of the release action, split out of
 * `beat-register-release-core.ts` to stay under the 300-line file
 * guideline (iterate-2026-08-18-org-route-beat-register). The generic
 * guarded append lives in `audit-append.ts`.
 */

import { appendAuditLine, resolveParentLeadId } from "./audit-append.js";
import type { LstatFn } from "./beat-register.js";

export interface AuditDeps {
  leadsRoot: string;
  now: () => Date;
  lstat: LstatFn;
}

/**
 * MIRRORED LIMITATION (plan-review PR-9, disclosed not fixed): this runs
 * AFTER the register lock is released, identical ordering to leadwright's
 * own `recoverRegisterEntry`. A crash or audit-write failure between the
 * two leaves a recovered entry with no `beat_recovered` line — a retry
 * finds the entry already closed (`recovered: false`) and does not
 * re-append. Sharing this limitation with the mirrored contract is
 * preferred over diverging into a different (and un-mirrored) failure mode.
 */
export function recordRecoveryAudit(
  deps: AuditDeps,
  leadId: string,
  auditPath: string,
  sessionId: string,
  reason: string,
  beatId: string,
): void {
  appendAuditLine(deps.leadsRoot, auditPath, deps.lstat, {
    ts: deps.now().toISOString(),
    kind: "beat_recovered",
    lead_id: leadId,
    parent_lead_id: resolveParentLeadId(deps.leadsRoot, leadId),
    beat_id: beatId,
    summary: `register entry recovered: session ${sessionId}`,
    data: { sessionId, reason },
  });
}
