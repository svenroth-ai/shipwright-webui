/*
 * campaignsApi.ts — client wrapper for the Campaigns lane endpoint (FR-01.31).
 *
 * Read-only sibling of `triageApi.ts`: raw `fetch` (the right precedent for a
 * loopback `/api/*` endpoint), 404 → [] so an unknown/synthesized project never
 * crashes the lane. Types mirror `server/src/core/campaign-store.ts`.
 */

import {
  httpJson,
  EXTERNAL_API,
  type CopyCommandForms,
  type ExternalTask,
} from "./externalApi";

export const CAMPAIGNS_API = "/api/campaigns";

export type CampaignStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "escalated";

/** Producer-owned campaign lifecycle status (mirror of the server type).
 *  draft = planned (triage-only), active = running (board), complete = done. */
export type CampaignLifecycleStatus = "draft" | "active" | "complete";

export interface CampaignStep {
  id: string;
  slug: string;
  title: string;
  status: CampaignStepStatus;
  /** Project-root-relative POSIX path to the sub-iterate spec, or null when
   *  the file is missing / unsafe (the copy-launch button disables on null). */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  /** Forward-compat plan-first/risk marker from the sub-iterate spec frontmatter
   *  (mirror of the server type). False for every campaign today; surfaces in the
   *  autonomous-launch risky-step warning the day a producer emits one. */
  planFirst: boolean;
}

export interface Campaign {
  slug: string;
  intent: string;
  branchStrategy: string | null;
  expandsTriage: string | null;
  /** Producer-owned lifecycle status; null = legacy (no status written yet). */
  status: CampaignLifecycleStatus | null;
  steps: CampaignStep[];
  done: number;
  total: number;
  nextPending: { id: string; specPath: string | null } | null;
}

export async function listCampaigns(projectId: string): Promise<Campaign[]> {
  const res = await fetch(`${CAMPAIGNS_API}/${encodeURIComponent(projectId)}`);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`campaigns list failed: ${res.status}`);
  }
  const body = (await res.json()) as { campaigns: Campaign[] };
  return body.campaigns;
}

/**
 * Campaigns the board should show. Producer-owned lifecycle status is
 * authoritative when present:
 *   - `active`   → shown (running).
 *   - `draft`    → hidden (planned; lives only in Triage).
 *   - `complete` → hidden (done).
 *   - `null`     → legacy (producer hasn't written a status yet) → fall back to
 *                  the derived `done < total` (so nothing existing breaks and
 *                  this can ship before the producer change). `total === 0`
 *                  is never active (guards the progress-bar divide-by-zero).
 */
export function selectActiveCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((c) => {
    if (c.status === "active") return true;
    if (c.status === "draft" || c.status === "complete") return false;
    return c.total > 0 && c.done < c.total; // legacy fallback
  });
}

/**
 * The not-yet-complete steps that an autonomous campaign run should NOT execute
 * unattended without an explicit acknowledgment: a step that previously `failed`
 * or `escalated` (the loop would blindly re-run it), or one flagged `planFirst`
 * via its sub-iterate spec frontmatter. Drives the autonomous-launch confirm
 * dialog's risky-step warning (FR-01.34 guardrail #2). Empty = clean to run.
 */
export function selectRiskyPendingSteps(campaign: Campaign): CampaignStep[] {
  return campaign.steps.filter(
    (s) =>
      s.status !== "complete" &&
      (s.status === "failed" || s.status === "escalated" || s.planFirst),
  );
}

/**
 * Launch an autonomous campaign run on a (freshly created) task. The server's
 * campaign branch validates the slug + builds the
 * `/shipwright-iterate --campaign <slug> --autonomous` command (the client never
 * dictates the command — Architecture rule 1). Own wrapper (not `externalApi`'s
 * `launchTask`) so the bloat-ceilinged `externalApi.ts` stays frozen.
 */
export async function launchCampaignRun(
  taskId: string,
  campaignSlug: string,
): Promise<{ task: ExternalTask; commands: CopyCommandForms }> {
  return await httpJson<{ task: ExternalTask; commands: CopyCommandForms }>(
    `${EXTERNAL_API}/tasks/${encodeURIComponent(taskId)}/launch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignSlug }),
    },
  );
}
