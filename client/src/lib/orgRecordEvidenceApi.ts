/*
 * orgRecordEvidenceApi.ts — asks the server whether the lead's quote occurs in the operator's own reject reason
 * (`rejected:<time>/<lead>`) or countersign note (`decision:ADR-<n>`) (iterate-2026-11-28-decision-record-evidence).
 * Server: `server/src/external/org/decision-record-evidence.ts` via `POST /api/org/decisions/record-evidence` (a POST
 * so the quote stays out of URLs). The operator's words come back only with `confirmed`.
 */
import { ORG_API } from "./orgApi";

export type RecordEvidenceResult =
  | { status: "confirmed"; form: "rejected" | "decision"; file: string; words: string }
  | { status: "quote_not_found" | "no_words"; form: "rejected" | "decision"; file: string }
  | { status: "unreadable"; form: "rejected" | "decision"; file: string; detail: string };

/** Every record-evidence query starts with this key; a reject or countersign invalidates all of them. */
export const RECORD_EVIDENCE_KEY = ["org", "record-evidence"] as const;

const STATUSES = new Set(["confirmed", "quote_not_found", "no_words", "unreadable"]);

export async function fetchRecordEvidence(pointer: string, quote: string): Promise<RecordEvidenceResult> {
  const r = await fetch(`${ORG_API}/decisions/record-evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pointer, quote }),
  });
  if (!r.ok) throw new Error(`record evidence check failed (HTTP ${r.status})`);
  const body = (await r.json()) as Partial<RecordEvidenceResult> & { words?: unknown; detail?: unknown };
  if (typeof body.status !== "string" || !STATUSES.has(body.status)) throw new Error("record evidence check returned an unknown answer");
  if (body.status === "confirmed" && typeof body.words !== "string") throw new Error("record evidence check returned no words");
  return body as RecordEvidenceResult;
}
