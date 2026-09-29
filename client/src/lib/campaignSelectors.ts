import type { Campaign, CampaignLifecycleStatus, CampaignStep } from "./campaignsApi";

/**
 * A campaign is effectively done when the producer marked it `complete`, OR
 * every step is finished (`total > 0 && done >= total`). The second clause is
 * load-bearing: a campaign driven via individual sub-iterate PRs (rather than
 * the autonomous loop's `update-status` call, which auto-flips active→complete)
 * never gets its lifecycle bumped, so it stays `active` even at done==total.
 * Without this clause such a campaign rendered on the board forever (reported
 * 2026-06-05). `total === 0` (a freshly-started campaign with no steps yet) is
 * never "done".
 */
export function isCampaignDone(c: Campaign): boolean {
  return c.status === "complete" || (c.total > 0 && c.done >= c.total);
}

/**
 * Campaigns the board's default lane should show — running work only. Hidden:
 *   - `draft`            → planned; lives only in Triage.
 *   - done               → `complete` lifecycle OR every step finished
 *                          (done >= total), even with a stale `active`
 *                          lifecycle — see `isCampaignDone`.
 *   - legacy idle        → status `null` AND nothing left (done >= total, or
 *                          no steps; the latter also guards the progress-bar
 *                          divide-by-zero).
 * Shown: `active` with work remaining (incl. a fresh campaign with no steps
 * yet), or legacy (`null`) with `done < total`.
 *
 * Exception — `derivedFromEvents`: an events-only campaign (planning dir absent
 * on a deployed clone) carries ONLY completed sub-iterates, so it always reads
 * `done == total` and `isCampaignDone` would hide it. But events can't reveal
 * pending steps, so "all known steps done" ≠ "campaign finished" — we keep it
 * visible so the deployed board surfaces its progress (the whole point of the
 * projection). `draft` is impossible for a synthesized campaign (status null).
 */
export function selectActiveCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter((c) => {
    if (c.status === "draft") return false;
    if (c.derivedFromEvents) return true;
    if (isCampaignDone(c)) return false;
    if (c.status === "active") return true;
    return c.total > 0 && c.done < c.total; // legacy fallback (status null)
  });
}

/**
 * The default board lane: campaigns that would show (`selectActiveCampaigns`)
 * minus those an operator dismissed. `dismissed` is a webui-owned board
 * quittance (NOT a producer status); layered ON TOP of `selectActiveCampaigns`
 * so the would-be-visible rules stay unchanged. A missing `dismissed` (older
 * server / deploy-skew) is treated as not dismissed.
 */
export function selectVisibleCampaigns(campaigns: Campaign[]): Campaign[] {
  return selectActiveCampaigns(campaigns).filter((c) => !c.dismissed);
}

/**
 * The dismissed subset of the would-be-visible campaigns — the restore list
 * behind the "show dismissed" toggle. A campaign hidden for ANY other reason
 * (draft / done / legacy-idle) is NOT here; only ones the operator actively
 * dismissed that would otherwise occupy the lane.
 */
export function selectDismissedCampaigns(campaigns: Campaign[]): Campaign[] {
  return selectActiveCampaigns(campaigns).filter((c) => Boolean(c.dismissed));
}

/** Draft campaigns startable from the board (FR-01.61) — before A17 a `draft`
 *  lived only in Triage. Not-dismissed, never an events-only ghost. Kept apart
 *  from `selectVisibleCampaigns` so the active-lane semantics stay unchanged. */
export function selectDraftCampaigns(campaigns: Campaign[]): Campaign[] {
  return campaigns.filter(
    (c) => c.status === "draft" && !c.dismissed && !c.derivedFromEvents,
  );
}

/** The lifecycle a badge shows: producer status wins; a legacy `null` campaign
 *  falls back to the done/total heuristic (`complete` when finished, else
 *  `active`) — never invents `draft` for a legacy campaign. */
export function campaignLifecycleLabel(c: Campaign): CampaignLifecycleStatus {
  if (c.status) return c.status;
  return isCampaignDone(c) ? "complete" : "active";
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
