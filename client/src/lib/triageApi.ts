/*
 * triageApi.ts — fetch wrappers for /api/triage/*. Mirrors externalApi.ts
 * shape so hooks layer caching/polling without duplicating endpoint
 * strings.
 *
 * SoT for the wire shape: server/src/types/triage.ts (which itself
 * mirrors shared/scripts/triage.py).
 */

export const TRIAGE_API = "/api/triage";

export type TriageStatus = "triage" | "promoted" | "dismissed" | "snoozed";
export type TriageSeverity = "critical" | "high" | "medium" | "low" | "info";
export type TriageKind =
  | "bug"
  | "feature"
  | "improvement"
  | "compliance"
  | "maintenance";
export type TriagePriority = "P0" | "P1" | "P2" | "P3";
export type TriageComplexityHint = "small" | "medium" | "large";

export interface TriageItem {
  id: string;
  ts: string;
  originalTs: string;
  source: string;
  severity: TriageSeverity;
  kind: TriageKind;
  title: string;
  detail: string;
  evidencePath: string | null;
  runId: string | null;
  commit: string | null;
  dedupKey: string | null;
  /**
   * Producer-generated ready-to-paste block — see header on
   * server/src/types/triage.ts (verbatim mirror). Optional so legacy
   * append events without the field still load cleanly.
   */
  launchPayload?: string | null;
  status: TriageStatus;
  suggestedPriority: TriagePriority;
  suggestedDomain: string;
  statusBy: string | null;
  statusReason: string | null;
  promotedTaskId: string | null;
  /**
   * FR-01.33 server-side enrichment (see server/src/types/triage.ts). When a
   * campaign has `expandsTriage == this item's id`, its slug + lifecycle
   * status; null/absent otherwise. Drives the Triage "Start Campaign" action.
   */
  campaignSlug?: string | null;
  campaignStatus?: "draft" | "active" | "complete" | null;
}

export interface TriageCountsResponse {
  counts: Record<string, number>;
  total: number;
}

export interface PromoteBody {
  triageId: string;
  priority: TriagePriority;
  domain: string;
  complexityHint?: TriageComplexityHint;
  tags: string[];
}

export interface PromoteResponse {
  task: { taskId: string; promotedFromTriageId?: string };
  triageId: string;
  newStatus: "promoted";
  recovered: boolean;
}

export interface PromotePartialResponse {
  error: "promote_partial";
  taskId: string;
  triageId: string;
  code: string;
  message: string;
}

export type PromoteResult =
  | { kind: "ok"; data: PromoteResponse }
  | { kind: "partial"; data: PromotePartialResponse }
  | { kind: "error"; status: number; body: unknown };

export interface StatusFlipBody {
  triageId: string;
  reason?: string | null;
}

export async function listTriageItems(projectId: string): Promise<TriageItem[]> {
  const res = await fetch(`${TRIAGE_API}/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`triage list failed: ${res.status}`);
  }
  const body = (await res.json()) as { items: TriageItem[] };
  return body.items;
}

export async function getTriageCounts(): Promise<TriageCountsResponse> {
  const res = await fetch(`${TRIAGE_API}/counts`);
  if (!res.ok) {
    throw new Error(`triage counts failed: ${res.status}`);
  }
  return (await res.json()) as TriageCountsResponse;
}

export async function promoteTriageItem(
  projectId: string,
  body: PromoteBody,
): Promise<PromoteResult> {
  const res = await fetch(
    `${TRIAGE_API}/${encodeURIComponent(projectId)}/promote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 201) {
    return { kind: "ok", data: (await res.json()) as PromoteResponse };
  }
  if (res.status === 207) {
    return {
      kind: "partial",
      data: (await res.json()) as PromotePartialResponse,
    };
  }
  const errorBody = await res
    .json()
    .catch(() => ({ error: "unknown_error" }));
  return { kind: "error", status: res.status, body: errorBody };
}

export async function dismissTriageItem(
  projectId: string,
  body: StatusFlipBody,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const res = await fetch(
    `${TRIAGE_API}/${encodeURIComponent(projectId)}/dismiss`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: "unknown_error" }));
    return { ok: false, status: res.status, body: b };
  }
  return { ok: true };
}

export async function snoozeTriageItem(
  projectId: string,
  body: StatusFlipBody,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const res = await fetch(
    `${TRIAGE_API}/${encodeURIComponent(projectId)}/snooze`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: "unknown_error" }));
    return { ok: false, status: res.status, body: b };
  }
  return { ok: true };
}

export function filterTriage(items: TriageItem[]): TriageItem[] {
  return items.filter((it) => it.status === "triage");
}
