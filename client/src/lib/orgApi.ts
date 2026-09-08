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
// GET /leads/:leadId/last-run and GET /leads/:leadId/beat-register are read
// ONLY through the secret-gated family — mirrored verbatim anyway per the
// iterate spec's Design Notes "Type mirror" fix (Internal Review, HIGH) —
// the discriminated-union schema-sync guard was proved against exactly this
// set of six types. `POST .../beat-register/release` (below) IS reachable
// through the plain `/api/org/*` browser proxy as of
// iterate-2026-09-06-org-lead-staleness-register (FR-04.41's release
// action) — the two GET reads stay secret-gated only.
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

/** See `server/src/types/org.ts`'s `LeadLastRunView` doc comment — a named
 *  type, not inlined, so `org-schema-sync.test.ts`'s per-arm comparison
 *  (which only walks top-level arm fields) actually checks it. */
export type LeadLastRunView =
  | { measured: false }
  | {
      measured: true;
      lastRunAt: string;
      staleness: Staleness | "unknown";
      cadenceUnresolvedReason?: CadenceUnresolvedReason;
    };

export type LeadNowState =
  | { state: "running" }
  | { state: "resting"; lastRun: LeadLastRunView }
  | { state: "needs-attention"; reason: "duplicate-session" }
  | { state: "not-measured" };

export type LeadRoleView = { measured: false } | { measured: true; text: string };

export type LeadCadenceView =
  | { measured: false }
  | { measured: true; text: string; cron: string };

/** See `server/src/types/org.ts`'s `LeadRegisterView` doc comment — the
 *  roster's own register-health view, with a fourth `unknown` arm a read
 *  failure degrades to (never silently `clear`). */
export type LeadRegisterView =
  | { leadId: string; status: "clear" }
  | { leadId: string; status: "open"; entry: BeatRegisterEntryView }
  | {
      leadId: string;
      status: "fault";
      reason: "duplicate-session-id";
      sessionId: string;
      entries: BeatRegisterEntryView[];
    }
  | { leadId: string; status: "unknown" };

export interface LeadRosterEntry {
  leadId: string;
  domain: string;
  name: string;
  reportsTo: string | null;
  role: LeadRoleView;
  now: LeadNowState;
  cadence: LeadCadenceView;
  usage: UsageResponse;
  register: LeadRegisterView;
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
// Fetchers — split out to `orgApi.fetchers.ts` (CLAUDE.md 300-line rule).
// Types above stay here: `org-schema-sync.test.ts` parses THIS file's text
// directly by path for the server/client type mirror.
//
// This re-export makes `orgApi.fetchers.ts` (which imports `ORG_API` and the
// types above back from THIS file) circular — safe only because `ORG_API`
// and every type are already bound above this line before the circular
// import resolves, and every fetcher reads them at CALL time, never at
// module-evaluation time. Keep both invariants if you touch this file: don't
// move `ORG_API`/types below this line, and don't add fetcher-side top-level
// code that reads them eagerly.
// ---------------------------------------------------------------------------

export * from "./orgApi.fetchers";
