/*
 * orgRejectApi.ts — the reject fetcher + the rejected-keys read (campaign
 * shadow-proposals-webui, W3). Split from `orgDecisionsApi.ts`, which stays
 * the parser + countersign home. Server twin: `routes/org-writes.ts`.
 */
import { ApiError } from "./externalApi";
import { ORG_API } from "./orgApi";

export type RejectResult =
  | { ok: true; alreadyRejected: boolean }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "duplicate"; count: number }
  | { ok: false; reason: "already-countersigned"; adr: number };

/** `POST /api/org/decisions/reject`. Other failures throw {@link ApiError}. */
export async function rejectDecision(timestamp: string, leadId: string, reason: string): Promise<RejectResult> {
  const r = await fetch(`${ORG_API}/decisions/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp, leadId, reason }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    body = { error: `HTTP ${r.status}` };
  }
  if (r.status === 404) return { ok: false, reason: "not-found" };
  if (r.status === 409 && body.error === "duplicate_proposal_identity") {
    return { ok: false, reason: "duplicate", count: typeof body.count === "number" ? body.count : 0 };
  }
  if (r.status === 409 && body.error === "already_countersigned") {
    return { ok: false, reason: "already-countersigned", adr: typeof body.number === "number" ? body.number : 0 };
  }
  if (!r.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : `http_${r.status}`, r.status, body);
  }
  return { ok: true, alreadyRejected: body.alreadyRejected === true };
}

export interface RejectedKey {
  key: string;
  entryTimestamp: string;
}

/** Per lead, the decision keys the operator already rejected. */
export async function fetchRejectedKeys(leadIds: string[]): Promise<Record<string, RejectedKey[]>> {
  if (leadIds.length === 0) return {};
  const r = await fetch(`${ORG_API}/decisions/rejected-keys?leadIds=${encodeURIComponent(leadIds.join(","))}`);
  if (!r.ok) return {}; // a missing repeat hint must never hide the proposals
  const body = (await r.json()) as { byLead?: Record<string, RejectedKey[]> };
  return body.byLead ?? {};
}
