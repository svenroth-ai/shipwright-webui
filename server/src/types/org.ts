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

/**
 * `resting`'s last-run sub-shape — a NAMED type (not inlined into
 * `LeadNowState`) so `org-schema-sync.test.ts`'s per-arm comparison, which
 * only walks TOP-LEVEL arm fields, actually checks it: an inlined nested
 * object is invisible to that guard (internal-plan-review finding,
 * iterate-2026-09-06-org-lead-staleness-register).
 *
 * Carries the SAME staleness verdict `lastRunCore` already computes —
 * `staleness`/`cadenceUnresolvedReason` are taken verbatim, never
 * recomputed from `lastRunAt` + a cron string client-side (two
 * implementations of one rule drift). `staleness: "unknown"` is a THIRD
 * state, not a synonym for fresh or stale — it must never render as if the
 * cadence were resolved.
 */
export type LeadLastRunView =
  | { measured: false }
  | {
      measured: true;
      lastRunAt: string;
      staleness: Staleness | "unknown";
      cadenceUnresolvedReason?: CadenceUnresolvedReason;
    };

/** The Now block's four states (iterate spec AC-2) — "waiting on you" is
 *  deliberately absent, see the iterate spec's Design Notes. */
export type LeadNowState =
  | { state: "running" }
  | { state: "resting"; lastRun: LeadLastRunView }
  | { state: "needs-attention"; reason: "duplicate-session" }
  | { state: "not-measured" };

export type LeadRoleView = { measured: false } | { measured: true; text: string };

export type LeadCadenceView =
  | { measured: false }
  | { measured: true; text: string; cron: string };

/**
 * The roster's OWN register-health view — deliberately NOT
 * `BeatRegisterHealthResponse` (that type's `clear`/`open`/`fault` are
 * exactly what `evaluateRegisterHealth` returns for the secret-gated route,
 * and stays that way). This adds a FOURTH arm, `unknown`, for a genuine
 * read failure (symlink refusal, corrupt file, path traversal, read
 * error) — internal-plan-review finding: those failures are not "no open
 * entry", and collapsing them into `clear` would fabricate a health claim
 * for exactly the fault cases that matter. Arms are spelled out literally
 * (not `BeatRegisterHealthResponse | {...unknown}`) because
 * `org-schema-sync.test.ts`'s arm parser requires each union member to be
 * its own `{ ... }` literal with a discriminant, not a bare type reference.
 */
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
  /** FR-04.41 — the beat-register's own classification. See
   *  `LeadRegisterView`'s doc comment for why a read failure is `unknown`,
   *  never silently `clear`. */
  register: LeadRegisterView;
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
