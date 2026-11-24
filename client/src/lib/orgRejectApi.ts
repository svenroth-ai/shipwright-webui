/*
 * orgRejectApi.ts — the reject fetcher + the rejected-keys read (campaign
 * shadow-proposals-webui, W3). Split from `orgDecisionsApi.ts`, which stays
 * the parser + countersign home. Server twin: `routes/org-writes.ts`.
 */
import { ApiError } from "./externalApi";
import { ORG_API } from "./orgApi";

export type RejectResult =
  /** `recorded`: this request wrote the audit record (false = it was already there, or the entry was gone). */
  | { ok: true; alreadyRejected: boolean; recorded: boolean; /** an earlier record of this webui was reused: the reason on record (`null` = none) */ existingReason?: string | null }
  | { ok: false; reason: "entry-changed" }
  | { ok: false; reason: "audit-unwritable"; message: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "lead-unknown" }
  | { ok: false; reason: "duplicate"; count: number }
  | { ok: false; reason: "already-countersigned"; adr: number }
  /** In the log already, but its countersign audit record is missing: countersign again after fixing the audit file. */
  | { ok: false; reason: "audit-pending"; adr: number; message: string };

/** `POST /api/org/decisions/reject`. Other failures throw {@link ApiError}. */
export async function rejectDecision(timestamp: string, leadId: string, reason: string, fingerprint?: string): Promise<RejectResult> {
  const r = await fetch(`${ORG_API}/decisions/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp, leadId, reason, ...(fingerprint === undefined ? {} : { fingerprint }) }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    body = { error: `HTTP ${r.status}` };
  }
  if (r.status === 404) return { ok: false, reason: body.error === "lead_unknown" ? "lead-unknown" : "not-found" };
  if (r.status === 409 && body.error === "duplicate_proposal_identity") {
    return { ok: false, reason: "duplicate", count: typeof body.count === "number" ? body.count : 0 };
  }
  if (r.status === 409 && body.error === "entry_changed") return { ok: false, reason: "entry-changed" };
  if (r.status === 409 && body.error === "audit_unwritable") return { ok: false, reason: "audit-unwritable", message: typeof body.message === "string" ? body.message : "The audit file of this lead cannot be used." };
  if (r.status === 409 && body.error === "already_countersigned") {
    return { ok: false, reason: "already-countersigned", adr: typeof body.number === "number" ? body.number : 0 };
  }
  if (r.status === 409 && body.error === "countersign_audit_pending") {
    return { ok: false, reason: "audit-pending", adr: typeof body.number === "number" ? body.number : 0, message: typeof body.message === "string" ? body.message : "The audit record is missing." };
  }
  if (!r.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : `http_${r.status}`, r.status, body);
  }
  return {
    ok: true,
    alreadyRejected: body.alreadyRejected === true,
    recorded: body.recorded === true,
    ...(body.reasonKept === true ? { existingReason: typeof body.existingReason === "string" ? body.existingReason : null } : {}),
  };
}

export interface RejectedKey {
  key: string;
  entryTimestamp: string;
}

const BATCH = 50; // the server reads at most this many leads per request

/** Per lead, the decision keys the operator already rejected. */
export async function fetchRejectedKeys(leadIds: string[]): Promise<Record<string, RejectedKey[]>> {
  const out: Record<string, RejectedKey[]> = {};
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const batch = leadIds.slice(i, i + BATCH);
    const r = await fetch(`${ORG_API}/decisions/rejected-keys?leadIds=${encodeURIComponent(batch.join(","))}`);
    if (!r.ok) continue; // a missing repeat hint must never hide the proposals
    const body = (await r.json()) as { byLead?: Record<string, RejectedKey[]> };
    Object.assign(out, body.byLead ?? {});
  }
  return out;
}
