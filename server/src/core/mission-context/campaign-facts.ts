/*
 * core/mission-context/campaign-facts.ts — WHAT a campaign session is made of,
 * and WHICH of its units is the active one.
 *
 * Split from `campaign-artifacts.ts` at the 300-LOC rule when provenance was
 * added. The seam is real rather than arbitrary: this file is the vocabulary
 * (facts + the selection rule), that file is the presentation (descriptors).
 * `selectActiveStep` lives here because `slice3-sources.ts` needs the SELECTION
 * without needing any descriptor.
 */

import type { SubIterateSelection } from "./types.js";

/** One sub-iterate as the campaign's own records describe it. */
export interface CampaignStepFacts {
  id: string;
  title: string;
  status: string;
  /**
   * Where THIS unit's status came from — per-unit, because the claim it
   * qualifies is per-unit. A campaign can mix: `status.json` naming S1 but not
   * S2 makes S1's status live and S2's a plan-table row, and a campaign-level
   * flag would vouch for both (external plan review, openai HIGH #5).
   */
  statusSource: "status_json" | "campaign_md" | "events" | "default";
  /** Project-root-relative POSIX path to this unit's spec; null when absent. */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
}

/**
 * How much weight the facts below can carry.
 *
 * `campaign-store` falls back from the live `status.json` to the `campaign.md`
 * table when the former is missing or torn. That fallback is useful and stays —
 * but it used to be SILENT, so "S2 is running now" could be rendered from a
 * hand-maintained plan document while the live status file was unreadable, with
 * nothing on screen saying so. These two fields are what make that visible.
 */
export interface CampaignProvenanceFacts {
  statusSource: "status_json" | "campaign_md" | "events" | "none";
  /** A source EXISTED and could not be read. Absent ≠ degraded. */
  degraded: boolean;
  /** WHICH source, so a disclosure never names the wrong file. */
  statusJsonState: "ok" | "absent" | "unreadable";
  campaignMdUnreadable: boolean;
}

export interface CampaignFacts {
  slug: string;
  intent: string | null;
  lifecycle: string | null;
  branchStrategy: string | null;
  done: number;
  total: number;
  steps: CampaignStepFacts[];
  provenance: CampaignProvenanceFacts;
}

/**
 * `unavailable` means the campaign store could not be read — NOT that the
 * campaign is empty. The distinction is the whole point of the state model.
 */
export type CampaignFact =
  | { status: "ok"; campaign: CampaignFacts }
  | { status: "unavailable" };

/** A resolved, existence-checked document the resolver has minted an id for. */
export interface ResolvedDoc {
  documentId: string;
  title: string;
}

/**
 * Pick the ACTIVE sub-iterate, and record WHY.
 *
 * The basis travels on the wire (`selectedBy`) because "which one is running" is
 * a claim, and a claim whose basis is invisible drifts without anyone noticing.
 *
 *   1. a unit explicitly `in_progress`               → that one
 *   2. else the first unit that is not `complete`    → the one the campaign is
 *      blocked on. `failed` and `escalated` land here on purpose: a stuck unit
 *      IS the active one, and skipping past it would hide the problem.
 *   3. else (everything complete) the LAST unit      → a finished campaign shows
 *      where it ended rather than nothing at all.
 */
export function selectActiveStep(
  steps: readonly CampaignStepFacts[],
): { step: CampaignStepFacts; selectedBy: SubIterateSelection } | null {
  if (steps.length === 0) return null;

  const running = steps.find((s) => s.status === "in_progress");
  if (running) return { step: running, selectedBy: "in_progress" };

  const incomplete = steps.find((s) => s.status !== "complete");
  if (incomplete) return { step: incomplete, selectedBy: "first_incomplete" };

  return { step: steps[steps.length - 1], selectedBy: "last_complete" };
}

// ---------------------------------------------------------------------------
// The basis of a claim
// ---------------------------------------------------------------------------

/**
 * The one sentence that turns a silent fallback into an honest one.
 *
 * `campaign-store` drops from the live `status.json` to the `campaign.md` table
 * when the former is missing or torn, and until this iterate that fallback left
 * no trace: "S2 is running now" read identically whether it came from the live
 * status file or from a plan document written days earlier. The three cases are
 * genuinely different claims and get genuinely different words.
 *
 * Returns "" when the facts came from the live file — the common case must not
 * be cluttered with a disclosure that says nothing.
 */
export function provenanceNote(
  c: CampaignFacts,
  /**
   * The SOURCE to qualify. For a per-unit claim this is that unit's own source,
   * which can differ from the campaign's overall one; omit it for a
   * campaign-wide claim and the campaign's own source is used.
   */
  source?: CampaignStepFacts["statusSource"],
): string {
  // The type requires `provenance`, so an absent one means an untyped path
  // reached here. Throwing would 500 the whole mission endpoint over a missing
  // disclosure — the opposite of the degrade-honestly rule this module keeps.
  // Treat it as an unknown basis and SAY so, rather than silently vouching.
  if (!c.provenance) {
    return " Where this status came from could not be established.";
  }
  const from = source ?? c.provenance.statusSource;

  // WHERE THE VALUE CAME FROM IS RESOLVED FIRST, and `default` means it came
  // from nowhere: neither source named this unit, so `pending` is THIS READER's
  // own assumption. Attributing it to a document is a claim about a document
  // that never mentioned it.
  //
  // This branch used to sit BELOW the file-level ones, so whenever `status.json`
  // was unreadable — which is one of the two ways to reach `default` — the
  // sentence became "…so this comes from its plan document and may be out of
  // date." The plan document said nothing either. A reader's default, laundered
  // into a cited source, by the disclosure written to prevent exactly that
  // (internal code-review cascade, FIX 2).
  //
  // The two facts are both true when a source also failed, so they COMPOSE
  // rather than one silencing the other.
  if (from === "default") {
    const because =
      c.provenance.statusJsonState === "unreadable"
        ? " Its live status file could not be read, so that may say otherwise."
        : c.provenance.campaignMdUnreadable
          ? " Its plan document could not be read, so that may say otherwise."
          : "";
    return ` No record of this unit's progress was found, so this is an assumption rather than a reported state.${because}`;
  }
  if (from === "events") {
    return " This was reconstructed from the completed-work record, because the campaign's own files are not in this copy of the project.";
  }

  // NAME THE RIGHT FILE. A single `degraded` boolean cannot: `campaign.md` can
  // be the one that failed while `status.json` read perfectly, and saying "the
  // live status file could not be read" there is a false statement — the exact
  // category of error this whole iterate exists to remove, made by the
  // disclosure meant to prevent it (external code review, openai #4).
  if (c.provenance.statusJsonState === "unreadable") {
    return " This campaign's live status file could not be read, so this comes from its plan document and may be out of date.";
  }
  if (c.provenance.campaignMdUnreadable) {
    return " This campaign's plan document could not be read, so some details may be missing.";
  }
  if (from === "campaign_md") {
    // "No live status file" is only true when there ISN'T one. A file that
    // exists but does not mention THIS unit is a different fact, and claiming
    // otherwise misdescribes a partial status file (openai #5).
    return c.provenance.statusJsonState === "ok"
      ? " The live status file does not record this unit, so this comes from the campaign's plan document."
      : " This campaign has no live status file, so this comes from its plan document.";
  }
  return "";
}
