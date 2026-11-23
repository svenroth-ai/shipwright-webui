/*
 * external/org/decision-request-common.ts — what the countersign and reject
 * request handlers share: the identity checks of the request body, the
 * default author and the mapping of an unusable audit file to a response.
 * One module so the two routes cannot drift on these rules.
 */

import { userInfo } from "node:os";

import { ISO_TIMESTAMP_RE } from "./proposed-grammar.js";
import { LEAD_ID_RE } from "./_helpers.js";
import { AuditUnwritableError } from "./decisions-audit.js";

/** Who is deciding when the caller names nobody: the OS user running the server. */
export function osAuthor(): string {
  try {
    return userInfo().username || "operator";
  } catch {
    return "operator";
  }
}

export type DecisionIdentity =
  | { ok: true; timestamp: string; leadId: string }
  | { ok: false; status: 400; body: Record<string, unknown> };

/** `{timestamp, leadId}` of a decision request: canonical ISO-8601 UTC timestamp + a kebab-case lead id. */
export function parseDecisionIdentity(raw: { timestamp?: unknown; leadId?: unknown }): DecisionIdentity {
  const { timestamp, leadId } = raw;
  if (typeof timestamp !== "string" || timestamp.length === 0) return { ok: false, status: 400, body: { error: "timestamp_required" } };
  if (typeof leadId !== "string" || leadId.length === 0) return { ok: false, status: 400, body: { error: "leadId_required" } };
  // `$` still matches before one trailing "\n": reject a literal newline first so it 400s precisely.
  if (timestamp.includes("\n") || !ISO_TIMESTAMP_RE.test(timestamp)) return { ok: false, status: 400, body: { error: "timestamp_invalid", timestamp } };
  if (!LEAD_ID_RE.test(leadId)) return { ok: false, status: 400, body: { error: "leadId_invalid", leadId } };
  return { ok: true, timestamp, leadId };
}

/** The staleness fingerprint a browser sends with a decision (optional; absent = not checked). */
export const FINGERPRINT_RE = /^[0-9a-f]{32}$/;

/** `409 audit_unwritable`: the lead's audit.jsonl cannot be read or written; nothing was changed. */
export function auditUnwritableResult(err: AuditUnwritableError): { status: 409; body: Record<string, unknown> } {
  return { status: 409, body: { error: "audit_unwritable", leadId: err.leadId, message: err.message } };
}
