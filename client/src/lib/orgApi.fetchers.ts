/*
 * orgApi.fetchers.ts — the `/api/org/*` fetch functions, split out of
 * `orgApi.ts` (CLAUDE.md "Files under 300 lines"). Re-exported from
 * `orgApi.ts` so every existing `from "./orgApi"` / `from "../lib/orgApi"`
 * import keeps working unchanged.
 *
 * Types stay in `orgApi.ts` — `server/src/types/org-schema-sync.test.ts`
 * parses that file's text directly by path for the type mirror, so moving
 * type declarations out of it would silently blind that guard.
 */

import { ApiError, decodeApiError } from "./externalApi";
import { ORG_API } from "./orgApi";
import type {
  OrgChartView,
  LeadsRosterResponse,
  OrgThreadsResponse,
  AuditLogPage,
} from "./orgApi";

/** Thrown by {@link fetchOrgChart} when the chart is confirmed absent
 *  (404 `org_chart_missing`) — the nav-gating signal. */
export class OrgChartMissingError extends Error {
  constructor() {
    super("org_chart_missing");
    this.name = "OrgChartMissingError";
  }
}

/**
 * `GET /api/org/org-chart`. Throws {@link OrgChartMissingError} on a
 * confirmed 404 (distinct from every other failure — see
 * `useOrgChartPresence()`, which is the ONLY place this distinction should
 * be consumed for nav-gating) and {@link ApiError} (via `decodeApiError`)
 * on any other non-2xx.
 */
export async function fetchOrgChart(): Promise<OrgChartView> {
  const r = await fetch(`${ORG_API}/org-chart`, { cache: "no-store" });
  if (r.status === 404) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await r.json()) as Record<string, unknown>;
    } catch {
      /* payload stays {} — falls through to the generic ApiError below */
    }
    if (payload.error === "org_chart_missing") {
      throw new OrgChartMissingError();
    }
    throw new ApiError(typeof payload.error === "string" ? payload.error : "http_404", 404, payload);
  }
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as OrgChartView;
}

/** `GET /api/org/leads` — the whole roster in one call. */
export async function fetchLeadsRoster(): Promise<LeadsRosterResponse> {
  const r = await fetch(`${ORG_API}/leads`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as LeadsRosterResponse;
}

/**
 * `GET /api/org/file?path=` — a shared, GET/view-only org document
 * (`org-chart.json`, `conventions.md`, `principal.md`, `decision_log.md`;
 * see the shared-documents block). Throws {@link ApiError} on any non-2xx —
 * callers distinguish "not found" via `err.status === 404`.
 */
export async function fetchOrgFileText(relpath: string): Promise<string> {
  const r = await fetch(`${ORG_API}/file?path=${encodeURIComponent(relpath)}`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return r.text();
}

/** `GET /api/org/threads` — every lead's follow-up-card threads, one call. */
export async function fetchOrgThreads(): Promise<OrgThreadsResponse> {
  const r = await fetch(`${ORG_API}/threads`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as OrgThreadsResponse;
}

/**
 * `GET /api/org/leads/:leadId/learnings` — a lead's own `learnings.md`,
 * read-only (Docs block). Same 404-on-missing contract as
 * {@link fetchOrgFileText}.
 */
export async function fetchLeadLearnings(leadId: string): Promise<string> {
  const r = await fetch(`${ORG_API}/leads/${encodeURIComponent(leadId)}/learnings`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return r.text();
}

/**
 * `GET /api/org/leads/:leadId/audit` — one bounded, newest-first page of a
 * lead's `audit.jsonl` (Docs block "Open log"). `before` is the opaque
 * `nextCursor` from a prior page; omit for the first (newest) page.
 */
export async function fetchLeadAuditLog(
  leadId: string,
  opts?: { before?: number; limit?: number },
): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  if (opts?.before !== undefined) params.set("before", String(opts.before));
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const r = await fetch(
    `${ORG_API}/leads/${encodeURIComponent(leadId)}/audit${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as AuditLogPage;
}
