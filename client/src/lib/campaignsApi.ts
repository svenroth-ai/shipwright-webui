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
