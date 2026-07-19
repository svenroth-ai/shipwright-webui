/*
 * campaign-types.ts — the shapes `campaign-store.ts` produces.
 *
 * Split out when `CampaignProvenance` pushed the store past the 300-LOC rule.
 * A cohesive split along the obvious seam: this file declares WHAT a campaign
 * is, `campaign-store.ts` decides how to READ one off disk. The store re-exports
 * everything here, so no consumer's import site moved.
 */

import type { CampaignLifecycleStatus } from "./campaign-status-json.js";

export type CampaignStepStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "failed"
  | "escalated";

// CampaignLifecycleStatus + status.json reading live in campaign-status-json.ts
// (the JSON-side input-reader, sibling of campaign-parse.ts). Re-exported so
// consumers importing the Campaign shape from here keep one import site.
export type { CampaignLifecycleStatus };

export interface CampaignStep {
  id: string;
  slug: string;
  title: string;
  status: CampaignStepStatus;
  /**
   * Where THIS step's `status` came from.
   *
   * Per-step, not per-campaign, because the claim it qualifies is per-step. A
   * campaign can legitimately mix: `status.json` lists S1 but not S2, so S1's
   * status is live and S2's comes from the plan table. A campaign-level flag
   * would report "live" for both and drop the disclosure on exactly the unit
   * that needed it (external plan review, openai HIGH #5).
   */
  statusSource: "status_json" | "campaign_md" | "events" | "default";
  /** Project-root-relative, POSIX-separated path to the sub-iterate spec.
   *  Null when the file is missing, escapes the root, or holds shell-hostile
   *  chars (so the copy-launch command is never malformed). */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  /** Forward-compat plan-first/risk marker read from the sub-iterate spec's
   *  optional frontmatter (`plan_first`/`risk`). False for every campaign that
   *  exists today (the producer writes no frontmatter); the autonomous-launch
   *  guardrail surfaces it the day a producer emits one. See
   *  `campaign-parse.ts parseSpecFrontmatter`. */
  planFirst: boolean;
}

/**
 * WHERE this campaign's per-unit facts came from, and whether getting them cost
 * us something.
 *
 * The fallback chain (`status.json` → the `campaign.md` table → `pending`) is
 * genuinely useful and stays. What it must stop doing is being SILENT: a
 * consumer that renders "S2 is running now" from a hand-maintained Markdown
 * table, because the live status file was torn, is making a claim it cannot
 * support, and today nothing on the wire lets it know.
 */
export interface CampaignProvenance {
  /**
   * `status_json`  — at least one unit's status came from the live status file.
   * `campaign_md`  — every status came from the plan document's table.
   * `events`       — reconstructed from the tracked event log because the
   *                  campaign directory is absent (a fresh clone). Completed
   *                  units only, so `total == done` says nothing about units
   *                  that never completed.
   * `none`         — no unit statuses were resolved from any source.
   */
  statusSource: "status_json" | "campaign_md" | "events" | "none";
  /**
   * True when a source EXISTED and could not be read (a torn/malformed
   * `status.json`, an unreadable `campaign.md`). NOT set merely because a file
   * is absent — an absent status file is an ordinary legacy campaign.
   *
   * Kept as the single "should this be qualified at all" switch; WHICH source
   * failed is the pair of fields below, because a disclosure that names the
   * wrong file is itself a false statement (external code review, openai #4).
   */
  degraded: boolean;
  /** `status.json`: read fine · not there at all · there and unusable. */
  statusJsonState: "ok" | "absent" | "unreadable";
  /** `campaign.md` existed and could not be read. */
  campaignMdUnreadable: boolean;
}

export interface Campaign {
  slug: string;
  intent: string;
  branchStrategy: string | null;
  expandsTriage: string | null;
  /** Producer-owned lifecycle status; null when the producer hasn't written
   *  one yet (legacy → consumers fall back to done/total). */
  status: CampaignLifecycleStatus | null;
  /** Where the per-unit facts came from, and whether a read degraded. */
  provenance: CampaignProvenance;
  steps: CampaignStep[];
  done: number;
  total: number;
  /** First step whose status is not complete (the step the campaign is blocked
   *  on, incl. a failed/escalated step that needs a re-run). Null when all
   *  complete. */
  nextPending: { id: string; specPath: string | null } | null;
  /**
   * True when an autonomous run is currently attached to this campaign — a live
   * `loop_state.json` `in_progress` unit, OR a `status.json` step `in_progress`.
   * Populated by `routes/campaigns.ts` (this reader leaves it undefined). The
   * launch CTAs disable/relabel on it to prevent spawning a SECOND orchestrator
   * on the same campaign. Optional for deploy-skew safety. See `core/campaign-loop-state.ts`.
   */
  attachedRun?: boolean;
  /** Reconstructed purely from tracked events.jsonl when the campaign dir is absent (a clone): completed subs only, total==done, specPath null. Set by `core/campaign-events.ts`. */
  derivedFromEvents?: boolean;
  /** True when an operator manually dismissed this campaign from the board (a webui-owned quittance, NOT a producer status). Set by `routes/campaigns.ts` from `core/dismissed-campaigns-store.ts`; optional for deploy-skew. */
  dismissed?: boolean;
}
