/*
 * campaignReadinessApi.ts — client wrapper + types for
 * GET /api/campaigns/:projectId/:slug/readiness (the campaign DAG view).
 *
 * Types are a verbatim mirror of the monorepo scheduler's `loop-readiness-1.0`
 * contract as passed through by `server/src/core/campaign-readiness.ts`. The
 * client renders the scheduler's verdict; it NEVER computes "ready" from the
 * `dependsOn` edges — readiness depends on git ancestry and branch strategy,
 * which only the scheduler can see.
 */

import { httpJson } from "./externalApi";

export interface UnitBlocker {
  /** The blocking dependency; null for a campaign-level gate. */
  id: string | null;
  reason: string;
  detail: string;
}

export interface UnitReadiness {
  id: string;
  /** Loop-state unit status: pending, claimed, running, built, reviewed, merging, merged, failed, held, … */
  state: string;
  ready: boolean;
  blocked_by: UnitBlocker[];
}

export interface ReadinessReport {
  schema_version: string;
  loop_id: string | null;
  branch_strategy: string;
  base_branch: string | null;
  supported: boolean;
  finalized: boolean;
  ready_ids: string[];
  units: UnitReadiness[];
}

export type CampaignReadiness =
  | { status: "report"; report: ReadinessReport }
  | { status: "no-loop" }
  | { status: "unsupported-version"; version: string }
  | { status: "engine-unavailable"; reason: string; repairCommand?: string }
  | { status: "failed"; reason: string };

export const READINESS_API_POLL_MS = 20_000;

export const campaignReadinessKey = (projectId: string, slug: string) =>
  ["campaign-readiness", projectId, slug] as const;

export function fetchCampaignReadiness(projectId: string, slug: string): Promise<CampaignReadiness> {
  return httpJson<CampaignReadiness>(
    `/api/campaigns/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}/readiness`,
  );
}

/** The scheduler's row for one step (case-insensitive id — the scheduler folds case). */
export function unitFor(report: ReadinessReport, stepId: string): UnitReadiness | undefined {
  const k = stepId.toLowerCase();
  return report.units.find((u) => u.id === stepId) ?? report.units.find((u) => u.id.toLowerCase() === k);
}
