/*
 * campaignsApi.ts — client wrapper for the Campaigns lane endpoint (FR-01.31).
 *
 * Read-only sibling of `triageApi.ts`: raw `fetch` (the right precedent for a
 * loopback `/api/*` endpoint), 404 → [] so an unknown/synthesized project never
 * crashes the lane. Types mirror `server/src/core/campaign-store.ts`.
 */

export const CAMPAIGNS_API = "/api/campaigns";

export type CampaignStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "escalated";

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
}

export interface Campaign {
  slug: string;
  intent: string;
  branchStrategy: string | null;
  expandsTriage: string | null;
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
 * Campaigns with work remaining (`done < total`). The lane renders only these
 * (parity with the Pipelines lane's `status === "in_progress"` gate); a
 * `total === 0` campaign is treated as not-active so the progress bar never
 * divides by zero.
 */
export function selectActiveCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((c) => c.total > 0 && c.done < c.total);
}
