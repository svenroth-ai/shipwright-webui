/*
 * external/org/reject-request.ts — request validation + `performReject` +
 * status mapping for the browser-facing reject route (campaign
 * shadow-proposals-webui, W3). Mirrors `countersign-request.ts`.
 */

import { performReject, type RejectCoreDeps, type RejectOutcome } from "./reject-core.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { normalizeReason, AuditUnwritableError } from "./decisions-audit.js";
import { osAuthor, parseDecisionIdentity, auditUnwritableResult, FINGERPRINT_RE } from "./decision-request-common.js";

export interface HandleRejectRequestDeps extends RejectCoreDeps {
  /** Who is deciding. Defaults to the OS user running the server. */
  author?: () => string;
}

export interface RejectRequestResult {
  status: 200 | 400 | 403 | 404 | 409;
  body: Record<string, unknown>;
}

export async function handleRejectRequest(
  deps: HandleRejectRequestDeps,
  rawBody: unknown,
): Promise<RejectRequestResult> {
  const body = (rawBody ?? {}) as { timestamp?: unknown; leadId?: unknown; reason?: unknown; fingerprint?: unknown };
  const id = parseDecisionIdentity(body);
  if (!id.ok) return { status: id.status, body: id.body };
  const { timestamp, leadId } = id;
  const { reason, fingerprint } = body;
  if (fingerprint !== undefined && fingerprint !== null && (typeof fingerprint !== "string" || !FINGERPRINT_RE.test(fingerprint))) {
    return { status: 400, body: { error: "fingerprint_invalid" } };
  }

  let outcome: RejectOutcome;
  try {
    outcome = await performReject(
      deps,
      timestamp,
      leadId,
      (deps.author ?? osAuthor)(),
      normalizeReason(reason),
      fingerprint,
    );
  } catch (err) {
    if (err instanceof OrgSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
    }
    if (err instanceof AuditUnwritableError) return auditUnwritableResult(err);
    if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
      return { status: 409, body: { error: "locked" } };
    }
    throw err;
  }

  switch (outcome.status) {
    case "not_found":
      return { status: 404, body: { error: "proposal_not_found", timestamp, leadId } };
    case "lead_unknown":
      return { status: 404, body: { error: "lead_unknown", leadId } };
    case "entry_changed":
      return { status: 409, body: { error: "entry_changed", timestamp, leadId } };
    case "duplicate_identity":
      return {
        status: 409,
        body: { error: "duplicate_proposal_identity", timestamp, leadId, count: outcome.count },
      };
    case "already_countersigned":
      return {
        status: 409,
        body: { error: "already_countersigned", timestamp, leadId, number: outcome.number },
      };
    default:
      return {
        status: 200,
        body: {
          rejected: true,
          alreadyRejected: outcome.status === "already_rejected",
          // truthful: false when this call wrote no audit record (the identical one was already there, or the entry was gone)
          recorded: outcome.status === "rejected" && outcome.recorded,
        },
      };
  }
}
