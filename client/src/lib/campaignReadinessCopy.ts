/*
 * campaignReadinessCopy.ts — the ONE place the scheduler's machine reasons become
 * words an operator can act on. Renders the scheduler's `blocked_by` verdict; it
 * decides nothing. An unknown reason (a future additive minor) falls back to the
 * scheduler's own `detail` text rather than being hidden.
 */

import type { CampaignReadiness, UnitBlocker } from "./campaignReadinessApi";

/** One plain-language line for one blocker. */
export function blockerSentence(b: UnitBlocker): string {
  const dep = b.id ?? "the campaign";
  switch (b.reason) {
    case "not_merged":
      return `waiting for ${dep} to merge`;
    case "commit_missing":
      return `${dep} is marked merged, but its commit couldn't be verified`;
    case "commit_not_on_base":
      return `${dep} merged, but its commit hasn't reached the base branch yet`;
    case "dependency_missing":
      return `depends on ${dep}, which is no longer in this campaign`;
    case "unsupported_strategy":
      return "this campaign's branch strategy can't run units in parallel";
    case "campaign_finalized":
      return "this campaign is already finalized";
    default:
      return b.detail || `blocked (${b.reason})`;
  }
}

/** The state line above the steps, or null when there is nothing to say. */
export function readinessBanner(
  r: CampaignReadiness | undefined,
  stale = false,
): { tone: "info" | "warn"; text: string } | null {
  if (!r) return null;
  if (stale) {
    // The last check failed; what's on screen is the previous answer.
    return { tone: "warn", text: "Showing the last known readiness — the latest check couldn't be completed, so it may be out of date." };
  }
  switch (r.status) {
    case "report":
      if (r.report.finalized) return { tone: "info", text: "This campaign is finalized — nothing more will be launched." };
      if (!r.report.supported) {
        return {
          tone: "warn",
          text: `The scheduler can't schedule this campaign (branch strategy “${r.report.branch_strategy}”). Units are shown, but none are reported ready.`,
        };
      }
      return null;
    case "no-loop":
      return { tone: "info", text: "No autonomous run is set up for this campaign — launch the next step by hand, or start an autonomous run." };
    case "unsupported-version":
      return { tone: "warn", text: `The scheduler reports a newer readiness format (${r.version}) than this Command Center understands — update the Command Center to see which units are ready.` };
    case "engine-unavailable":
      return { tone: "warn", text: `Readiness unavailable: ${r.reason}` };
    case "failed":
      return { tone: "warn", text: `Readiness check failed: ${r.reason}` };
  }
}

/** True when a scheduler verdict exists and per-unit launch should follow it. */
export function hasVerdict(r: CampaignReadiness | undefined): r is Extract<CampaignReadiness, { status: "report" }> {
  return r?.status === "report";
}

/**
 * Why a launch would go ahead WITHOUT a scheduler check — shown in the confirm
 * dialog so a fail-open launch is never silent. Null when either a verdict exists
 * or there is simply no loop (nothing to check against).
 */
export function uncheckedLaunchNotice(r: CampaignReadiness | undefined, stale = false): string | null {
  if (!stale && (!r || r.status === "report" || r.status === "no-loop")) return null;
  return "Readiness not checked — the scheduler's ready/blocked answer isn't available right now, so this launch is not verified against the dependency graph.";
}
