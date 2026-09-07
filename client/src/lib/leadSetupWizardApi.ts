/*
 * leadSetupWizardApi.ts — typed fetchers for the leadwright lead-setup
 * wizard (iterate-2026-09-07-leadwright-setup-wizard, W14), over the
 * plain-surface `/api/org/*` proxy (see `orgApi.ts`'s header — same
 * rationale, kept in its own module rather than growing `orgApi.ts` or
 * the bloat-ceilinged `externalApi.ts`).
 *
 * `PreflightLead` / `PreflightResult` etc. are a VERBATIM mirror of
 * `server/src/types/leadwright-preflight.ts` (CLAUDE.md rule 7) — that
 * file is itself a mirror of leadwright's own published contract, so this
 * is a mirror-of-a-mirror; kept in step by hand (no automated schema-sync
 * guard for this cross-repo-twice-removed shape, same posture the iterate
 * spec accepted for the server-side vendored schemas).
 */

import { ORG_API } from "./orgApi";
import { decodeApiError, type ApiError } from "./externalApi";

// ---------------------------------------------------------------------------
// Wire-shape mirrors (server/src/types/leadwright-preflight.ts).
// ---------------------------------------------------------------------------

/** Mirrors `server/src/types/leadwright-preflight.ts`'s `LEAD_ID_RE` —
 *  the same pattern used for both a new lead id AND a new domain (both are
 *  leadwright-facing kebab-case identifiers). One regex, shared by the
 *  wizard's "create new domain" action and `LeadwrightFields.tsx`'s
 *  converted select. */
export const LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export type PreflightTriggerEventType = "answer_received" | "chat_session_ended";
export type PreflightModel = "fast" | "balanced" | "deep";

export interface PreflightLead {
  name: string;
  domain: string;
  reports_to: string | null;
  manages: string[];
  charter_path: string;
  learnings_path: string;
  triggers: { cron: string; on: PreflightTriggerEventType[] };
  max_concurrent_tasks: number;
  budget: { window: "rolling-7d"; usd: number | null; pause_at: number; hard_stop_at: number };
  projects: string[];
  allowed_skills: string[];
  allowed_tools: string[];
  escalation_target: string;
  model: PreflightModel;
  paused: boolean;
}

export type PreflightFindingLayer = "MUSS" | "KANN" | "advisory";

export interface PreflightFinding {
  key: string;
  layer: PreflightFindingLayer;
  satisfied: boolean;
  unverifiable?: boolean;
  message: string;
}

export interface PreflightResult {
  ok: boolean;
  findings: PreflightFinding[];
}

export interface DaemonConfigAdditions {
  path: string;
  actionId: string;
  pluginDirs: string[];
}

// ---------------------------------------------------------------------------
// GET /api/org/domains — the shared domain vocabulary.
// ---------------------------------------------------------------------------

export interface DomainsResponse {
  domains: string[];
  unclaimedCounts: Record<string, number>;
}

export async function fetchDomains(): Promise<DomainsResponse> {
  const r = await fetch(`${ORG_API}/domains`, { cache: "no-store" });
  if (!r.ok) throw await decodeApiError(r);
  return (await r.json()) as DomainsResponse;
}

// ---------------------------------------------------------------------------
// POST /api/org/leads/verdict.
// ---------------------------------------------------------------------------

export interface LeadVerdictRequestBody {
  leadId: string;
  lead: PreflightLead;
  daemonConfigAdditions: DaemonConfigAdditions;
  charterContent?: string;
}

export type LeadVerdictResult =
  | { kind: "not_configured" }
  | { kind: "error"; error: ApiError }
  | { kind: "ran"; ranOk: true; result: PreflightResult; proposalDigest: string }
  | { kind: "ran"; ranOk: false; reason: string; proposalDigest: string };

export async function postLeadVerdict(body: LeadVerdictRequestBody): Promise<LeadVerdictResult> {
  const r = await fetch(`${ORG_API}/leads/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 503) return { kind: "not_configured" };
  if (!r.ok) return { kind: "error", error: await decodeApiError(r) };
  const json = (await r.json()) as
    | { ranOk: true; result: PreflightResult; proposalDigest: string }
    | { ranOk: false; reason: string; proposalDigest: string };
  return { kind: "ran", ...json };
}

// ---------------------------------------------------------------------------
// POST /api/org/leads/commit.
// ---------------------------------------------------------------------------

export interface LeadCommitRequestBody extends LeadVerdictRequestBody {
  charterContent: string;
  expectedProposalDigest: string;
}

export type LeadCommitResult =
  | { kind: "not_configured" }
  | { kind: "verdict_stale" }
  | { kind: "lead_exists" }
  /** A genuine cross-process lock conflict on daemon-config.json or
   *  org-chart.json (proper-lockfile ELOCKED) — transient contention, not
   *  stale data, so a plain retry (never an auto-retried verdict) is the
   *  right recovery. */
  | { kind: "locked" }
  /** External-review fix (openai, high — security): the server independently
   *  re-runs leadwright's real check before writing anything, and this is
   *  ITS verdict coming back red — never auto-retried (unlike verdict_stale,
   *  nothing about the submitted answers changed), the user must fix the
   *  findings the wizard is already showing. */
  | { kind: "verdict_not_ok"; findings: PreflightResult["findings"] }
  | { kind: "error"; error: ApiError }
  | { kind: "committed"; leadId: string; restartRequired: true; restartNotice: string }
  | { kind: "daemon_config_missing"; fragment: string };

export async function postLeadCommit(body: LeadCommitRequestBody): Promise<LeadCommitResult> {
  const r = await fetch(`${ORG_API}/leads/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 503) return { kind: "not_configured" };
  if (r.status === 409) {
    const payload = (await r.json().catch(() => ({}))) as { error?: string; findings?: PreflightResult["findings"] };
    if (payload.error === "org_chart_lead_exists") return { kind: "lead_exists" };
    if (payload.error === "daemon_config_locked" || payload.error === "org_chart_locked") {
      return { kind: "locked" };
    }
    if (payload.error === "verdict_not_ok") return { kind: "verdict_not_ok", findings: payload.findings ?? [] };
    return { kind: "verdict_stale" };
  }
  if (!r.ok) return { kind: "error", error: await decodeApiError(r) };
  const json = (await r.json()) as
    | { committed: true; leadId: string; restartRequired: true; restartNotice: string }
    | { committed: false; stage: "daemon-config"; fragment: string };
  if (json.committed) return { kind: "committed", ...json };
  return { kind: "daemon_config_missing", fragment: json.fragment };
}
