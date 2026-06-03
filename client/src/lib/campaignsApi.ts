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

/** Success shape of POST /:projectId/:slug/start (server always returns active). */
export interface StartCampaignResult {
  slug: string;
  status: "active";
}

export type StartCampaignOutcome =
  | { ok: true; data: StartCampaignResult }
  | { ok: false; status: number; error: string; message?: string };

/**
 * FR-01.33 — the Triage "Start Campaign" action. POSTs draft → active and
 * returns a discriminated result (mirrors triageApi's dismiss/snooze shape) so
 * the caller can surface 404 / 409 (already complete) / 422 (no writable
 * status target) / 503 (lock busy) inline instead of throwing. This is the ONE
 * WebUI write to campaign state — see server/src/core/campaign-write.ts + ADR.
 */
export async function startCampaign(
  projectId: string,
  slug: string,
): Promise<StartCampaignOutcome> {
  const res = await fetch(
    `${CAMPAIGNS_API}/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}/start`,
    { method: "POST" },
  );
  if (res.ok) {
    return { ok: true, data: (await res.json()) as StartCampaignResult };
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return {
    ok: false,
    status: res.status,
    error: body.error ?? "unknown_error",
    message: body.message,
  };
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
