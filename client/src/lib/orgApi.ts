/*
 * orgApi.ts — typed fetchers over the plain-surface `/api/org/*` proxy
 * (iterate spec Design Notes, "Server-side proxy route"). Kept in its own
 * module — same rationale as `markdownFileApi.ts` — separate from
 * `externalApi.ts`, which is at its bloat ceiling (see project memory).
 *
 * Every type below is a VERBATIM mirror of `server/src/types/org.ts`
 * (canonical) — CLAUDE.md rule 7's cross-package mirror discipline, guarded
 * by `org-schema-sync.test.ts`.
 */

import { ApiError, decodeApiError } from "./externalApi";

export const ORG_API = "/api/org";

/**
 * Mirrors the server's `LEADS_USAGE_REFRESH_INTERVAL_MS`
 * (`server/src/external/org/_helpers.ts:197`, 5 min) — the named
 * refresh-cadence for the roster read. Never a newly-invented interval.
 */
export const LEADS_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// GET /org-chart — a STRICT five-field-per-lead projection. Widening it is
// out of scope (see the iterate spec) — this mirror must not add fields.
// ---------------------------------------------------------------------------

export interface OrgChartLeadView {
  domain: string;
  name: string;
  reports_to: string | null;
  manages: string[];
  charter_path: string;
}

export interface OrgChartView {
  version: number;
  po: string;
  leads: Record<string, OrgChartLeadView>;
}

// ---------------------------------------------------------------------------
// Usage (embedded in the roster response, see below).
// ---------------------------------------------------------------------------

export type UsageResponse =
  | { leadId: string; measured: false }
  | {
      leadId: string;
      measured: true;
      costUsd: number;
      runCount: number;
      windowDays: number;
      asOf: string;
      /** Optional — an older producer (pre leadwright#38) omits both.
       *  A missing value must render as if it were absent, never as 0/false. */
      unpricedCallsTotal?: number;
      /** true = SOME sessions in this window measured, some didn't (a
       *  partial total). Absent/false = every session in the window measured. */
      anyNotMeasured?: boolean;
    };

// ---------------------------------------------------------------------------
// GET /leads/:leadId/last-run and GET /leads/:leadId/beat-register — NOT
// reachable through the plain `/api/org/*` browser proxy (secret-gated
// family only); mirrored verbatim anyway per the iterate spec's Design
// Notes "Type mirror" fix (Internal Review, HIGH) — the discriminated-union
// schema-sync guard was proved against exactly this set of six types.
// ---------------------------------------------------------------------------

/** Mirrors `server/src/external/org/cron.ts`'s `Staleness`. */
export type Staleness = "fresh" | "stale";

/** Mirrors `server/src/external/org/org-chart-lookup.ts`'s `LeadOrgInfoReason`. */
export type LeadOrgInfoReason =
  | "org_chart_missing"
  | "org_chart_symlink"
  | "org_chart_invalid"
  | "lead_not_found";

export type CadenceUnresolvedReason = LeadOrgInfoReason | "invalid_cron";

export type LastRunResponse =
  | { leadId: string; measured: false }
  | {
      leadId: string;
      measured: true;
      lastRunAt: string;
      sessionId: string;
      staleness: Staleness | "unknown";
      thresholdMs: number | null;
      cadenceMs: number | null;
      cadenceUnresolvedReason?: CadenceUnresolvedReason;
    };

export interface BeatRegisterEntryView {
  sessionId: string;
  beatId: string;
  leadId: string;
  pid: number;
  startedAt: string;
  closedAt: string | null;
}

export type BeatRegisterHealthResponse =
  | { leadId: string; status: "clear" }
  | { leadId: string; status: "open"; entry: BeatRegisterEntryView }
  | {
      leadId: string;
      status: "fault";
      reason: "duplicate-session-id";
      sessionId: string;
      entries: BeatRegisterEntryView[];
    };

// ---------------------------------------------------------------------------
// GET /leads — the composite roster read (one call, not N+1).
// ---------------------------------------------------------------------------

export type LeadNowState =
  | { state: "running" }
  | {
      state: "resting";
      lastRun: { measured: false } | { measured: true; lastRunAt: string };
    }
  | { state: "needs-attention"; reason: "duplicate-session" }
  | { state: "not-measured" };

export type LeadRoleView = { measured: false } | { measured: true; text: string };

export type LeadCadenceView =
  | { measured: false }
  | { measured: true; text: string; cron: string };

export interface LeadRosterEntry {
  leadId: string;
  domain: string;
  name: string;
  reportsTo: string | null;
  role: LeadRoleView;
  now: LeadNowState;
  cadence: LeadCadenceView;
  usage: UsageResponse;
}

export interface LeadsRosterResponse {
  leads: LeadRosterEntry[];
}

// ---------------------------------------------------------------------------
// GET /threads — every lead's follow-up-card threads, keyed by leadId
// (FR-04.42). Field set mirrors `OrgThreadCard` / `ThreadRound`
// (`components/org/OrgThread.tsx`) exactly — see server/src/types/org.ts.
// ---------------------------------------------------------------------------

export interface OrgThreadRoundView {
  id: string;
  question: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
}

export interface OrgThreadCardView {
  cardId: string;
  cardTitle: string;
  rounds: OrgThreadRoundView[];
}

export type OrgThreadsResponse = Record<string, OrgThreadCardView[]>;

// ---------------------------------------------------------------------------
// GET /leads/:leadId/audit — bounded, paginated audit-log page.
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  raw: string;
  parsed: Record<string, unknown> | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  total: number;
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Fetchers.
// ---------------------------------------------------------------------------

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
