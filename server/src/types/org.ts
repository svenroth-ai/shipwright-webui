/*
 * types/org.ts — canonical TS shapes for the leadwright org-directory route
 * family (`/api/external/org/*`, and its plain-surface mirror `/api/org/*`,
 * see `server/src/routes/org.ts`).
 *
 * `external/org/*.ts` import their response types from here instead of
 * declaring them inline, so the secret-gated route and the browser-facing
 * proxy can never drift on wire shape. Client-side mirrors (`client/src/lib/
 * orgApi.ts`) are verbatim copies of these — same discipline as
 * `triage.ts` / `action-schema.ts` (CLAUDE.md rule 7), guarded here by
 * `org-schema-sync.test.ts`'s union-arm comparison (these are discriminated
 * unions, not flat interfaces — the flat-interface field-name guard those
 * two files use does not apply).
 */

import type { Staleness } from "../external/org/cron.js";
import type { LeadOrgInfoReason } from "../external/org/org-chart-lookup.js";

// ---------------------------------------------------------------------------
// GET /org-chart — a STRICT five-field-per-lead projection (domain, name,
// reports_to, manages, charter_path). Widening it — adding `paused`,
// cadence, or `allowed_*` — is explicitly out of scope; see the iterate
// spec's Design Notes.
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
// GET /leads/:leadId/usage
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
// GET /leads/:leadId/last-run
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /leads/:leadId/beat-register
// ---------------------------------------------------------------------------

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
// GET /api/org/leads — the plain-surface composite roster read (one call,
// not N+1 — see the iterate spec's Design Notes). Per-lead figures that
// cannot be determined (a read failure, or — for `role`/`cadence` — no
// resolvable source) degrade to their own `measured: false` shape rather
// than a page-level error; a page-level broken state is reserved for the
// org-chart read itself (`GET /api/org/org-chart`, 502 `org_chart_invalid`).
// ---------------------------------------------------------------------------

/** The Now block's four states (iterate spec AC-2) — "waiting on you" is
 *  deliberately absent, see the iterate spec's Design Notes. */
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
// GET /api/org/threads — one round per follow-up card, keyed by leadId
// (FR-04.42, leadwright#35). Field set mirrors the ORG PAGE's own
// `OrgThreadCard` / `ThreadRound` component props
// (`client/src/components/org/OrgThread.tsx`) exactly, so
// `useOrgThreads`'s query result needs no reshaping before it reaches
// `<OrgThreadList>`. `round` and `questionType` from leadwright's on-disk
// record are deliberately dropped here — order is carried by array
// position (never re-derived from `round`), and `questionType` is
// leadwright's own vocabulary, not something this page's UI branches on.
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
// GET /api/org/leads/:leadId/audit — bounded, paginated `audit.jsonl` page
// (Docs block "Open log"; see `external/org/audit-log.ts` — never the whole
// growing file in one response).
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
