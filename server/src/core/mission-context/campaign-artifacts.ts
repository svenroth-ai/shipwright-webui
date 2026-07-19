/*
 * core/mission-context/campaign-artifacts.ts — NATIVE artifacts for a campaign
 * session (CONTRACT §4 scenario 5, §10 Slice 3).
 *
 * S1 recognised a campaign (a `campaign:<slug>` title backed by a REAL record —
 * a title alone is not evidence) but left it on "today's behavior". This module
 * resolves it properly, and the split it maintains is a CONTRACT requirement:
 *
 *   CAMPAIGN-LEVEL   `spec` (the campaign brief) · `campaign_runbook` ·
 *                    `campaign_progress`
 *   SUB-ITERATE      `sub_iterate` — the ONE active unit, with its own spec
 *
 * Keeping those apart is not presentation polish. A campaign of eight units has
 * eight sets of results, and a reader who mistakes one unit's commit for the
 * campaign's has been actively misled.
 *
 * Test counts are `number | null` and null NEVER renders as zero. `status.json`
 * leaves them null for a unit that has not reported; "0 of 0 tests passed" would
 * be a fabricated pass — the exact shape of the S2 review finding where an
 * unreadable count folded into "raised no issues".
 */

import type {
  CampaignProgressArtifact,
  CampaignRunbookArtifact,
  CampaignSubIterateRow,
  SpecArtifact,
  SubIterateArtifact,
  SubIterateSelection,
} from "./types.js";

/** One sub-iterate as the campaign's own records describe it. */
export interface CampaignStepFacts {
  id: string;
  title: string;
  status: string;
  /** Project-root-relative POSIX path to this unit's spec; null when absent. */
  specPath: string | null;
  commit: string | null;
  branch: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
}

export interface CampaignFacts {
  slug: string;
  intent: string | null;
  lifecycle: string | null;
  branchStrategy: string | null;
  done: number;
  total: number;
  steps: CampaignStepFacts[];
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

function unavailable<K extends string>(
  kind: K,
  label: string,
  note: string,
): { kind: K; label: string; state: "unavailable"; summary: null; receipt: null; note: string; detail: null } {
  return { kind, label, state: "unavailable", summary: null, receipt: null, note, detail: null };
}

// ---------------------------------------------------------------------------
// Campaign level
// ---------------------------------------------------------------------------

/** The campaign BRIEF (`campaign.md`) occupies the rail's `spec` slot. */
export function buildCampaignBriefArtifact(
  fact: CampaignFact,
  doc: ResolvedDoc | null,
): SpecArtifact {
  if (fact.status === "unavailable") {
    return unavailable("spec", "Campaign brief", "This campaign's records could not be read.");
  }
  if (!doc) {
    return {
      kind: "spec",
      label: "Campaign brief",
      state: "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }
  return {
    kind: "spec",
    label: "Campaign brief",
    state: "available",
    summary: fact.campaign.intent ?? "What this campaign as a whole set out to do.",
    receipt: doc.title,
    detail: { type: "document", documentId: doc.documentId, title: doc.title },
  };
}

export function buildRunbookArtifact(
  fact: CampaignFact,
  doc: ResolvedDoc | null,
): CampaignRunbookArtifact {
  if (fact.status === "unavailable") {
    return unavailable(
      "campaign_runbook",
      "Runbook",
      "This campaign's records could not be read.",
    );
  }
  if (!doc) {
    // Many campaigns genuinely have no runbook. A real absence, so it hides.
    return {
      kind: "campaign_runbook",
      label: "Runbook",
      state: "not_applicable",
      summary: null,
      receipt: null,
      detail: null,
    };
  }
  return {
    kind: "campaign_runbook",
    label: "Runbook",
    state: "available",
    summary: "The rules every unit of this campaign runs under.",
    receipt: doc.title,
    detail: { type: "document", documentId: doc.documentId, title: doc.title },
  };
}

function progressSummary(c: CampaignFacts, activeId: string | null): string {
  if (c.total === 0) return "This campaign has no units recorded yet.";
  if (c.done >= c.total) return `All ${c.total} units are complete.`;
  const tail = activeId ? ` Currently on ${activeId}.` : "";
  return `${c.done} of ${c.total} units complete.${tail}`;
}

export function buildCampaignProgressArtifact(
  fact: CampaignFact,
  activeId: string | null,
): CampaignProgressArtifact {
  if (fact.status === "unavailable") {
    return unavailable(
      "campaign_progress",
      "Campaign progress",
      "This campaign's records could not be read, so its progress is unknown.",
    );
  }

  const c = fact.campaign;
  const rows: CampaignSubIterateRow[] = c.steps.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    active: s.id === activeId,
  }));

  return {
    kind: "campaign_progress",
    label: "Campaign progress",
    state: "available",
    summary: progressSummary(c, activeId),
    receipt: `${c.done}/${c.total} complete`,
    detail: {
      type: "campaign_progress",
      slug: c.slug,
      lifecycle: c.lifecycle,
      branchStrategy: c.branchStrategy,
      done: c.done,
      total: c.total,
      rows,
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-iterate level
// ---------------------------------------------------------------------------

function subIterateSummary(
  step: CampaignStepFacts,
  selectedBy: SubIterateSelection,
): string {
  const name = `${step.id} — ${step.title}`;
  switch (step.status) {
    case "in_progress":
      return `${name} is running now.`;
    case "complete":
      return selectedBy === "last_complete"
        ? `${name} was the last unit, and it is complete.`
        : `${name} is complete.`;
    case "failed":
      return `${name} failed and is what the campaign is waiting on.`;
    case "escalated":
      return `${name} was escalated for a human decision.`;
    default:
      return `${name} has not started yet.`;
  }
}

export function buildSubIterateArtifact(
  fact: CampaignFact,
  doc: ResolvedDoc | null,
): SubIterateArtifact {
  const label = "Current unit";

  if (fact.status === "unavailable") {
    return unavailable(
      "sub_iterate",
      label,
      "This campaign's records could not be read, so its current unit is unknown.",
    );
  }

  const picked = selectActiveStep(fact.campaign.steps);
  if (!picked) {
    // The campaign record parsed and lists no units. A real, honest absence.
    return {
      kind: "sub_iterate",
      label,
      state: "not_applicable",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  const { step, selectedBy } = picked;
  return {
    kind: "sub_iterate",
    label,
    state: "available",
    summary: subIterateSummary(step, selectedBy),
    receipt: step.id,
    detail: {
      type: "sub_iterate",
      id: step.id,
      title: step.title,
      status: step.status,
      selectedBy,
      documentId: doc?.documentId ?? null,
      documentTitle: doc?.title ?? null,
      commit: step.commit,
      branch: step.branch,
      testsPassed: step.testsPassed,
      testsTotal: step.testsTotal,
    },
  };
}
