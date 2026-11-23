/*
 * external/org/reject-request.ts — request validation + `performReject` +
 * status mapping for the browser-facing reject route (campaign
 * shadow-proposals-webui, W3). Mirrors `countersign-request.ts`.
 */

import { userInfo } from "node:os";

import { performReject, type RejectCoreDeps, type RejectOutcome } from "./reject-core.js";
import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import { normalizeReason } from "./decisions-audit.js";
import { LEAD_ID_RE } from "./_helpers.js";

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface HandleRejectRequestDeps extends RejectCoreDeps {
  /** Who is deciding. Defaults to the OS user running the server. */
  author?: () => string;
}

export interface RejectRequestResult {
  status: 200 | 400 | 403 | 404 | 409;
  body: Record<string, unknown>;
}

function defaultAuthor(): string {
  try {
    return userInfo().username || "operator";
  } catch {
    return "operator";
  }
}

export async function handleRejectRequest(
  deps: HandleRejectRequestDeps,
  rawBody: unknown,
): Promise<RejectRequestResult> {
  const { timestamp, leadId, reason } = (rawBody ?? {}) as {
    timestamp?: unknown;
    leadId?: unknown;
    reason?: unknown;
  };
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    return { status: 400, body: { error: "timestamp_required" } };
  }
  if (typeof leadId !== "string" || leadId.length === 0) {
    return { status: 400, body: { error: "leadId_required" } };
  }
  if (timestamp.includes("\n") || !ISO_TIMESTAMP_RE.test(timestamp)) {
    return { status: 400, body: { error: "timestamp_invalid", timestamp } };
  }
  if (!LEAD_ID_RE.test(leadId)) {
    return { status: 400, body: { error: "leadId_invalid", leadId } };
  }

  let outcome: RejectOutcome;
  try {
    outcome = await performReject(
      deps,
      timestamp,
      leadId,
      (deps.author ?? defaultAuthor)(),
      normalizeReason(reason),
    );
  } catch (err) {
    if (err instanceof OrgSymlinkEscapeError) {
      return { status: 403, body: { error: "symlink_forbidden", path: err.path } };
    }
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
        body: { rejected: true, alreadyRejected: outcome.status === "already_rejected" },
      };
  }
}
