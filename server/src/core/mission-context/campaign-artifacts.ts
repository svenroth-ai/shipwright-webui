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

import {
  provenanceNote,
  selectActiveStep,
  type CampaignFact,
  type CampaignFacts,
  type CampaignStepFacts,
  type ResolvedDoc,
} from "./campaign-facts.js";
import type {
  CampaignProgressArtifact,
  CampaignRunbookArtifact,
  CampaignSubIterateRow,
  SpecArtifact,
  SubIterateArtifact,
  SubIterateSelection,
} from "./types.js";

// The vocabulary + the selection rule now live in `campaign-facts.ts`;
// re-exported so no consumer's import site moved.
export {
  selectActiveStep,
  type CampaignFact,
  type CampaignFacts,
  type CampaignProvenanceFacts,
  type CampaignStepFacts,
  type ResolvedDoc,
} from "./campaign-facts.js";

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
  if (c.done >= c.total) return `All ${c.total} units are complete.${provenanceNote(c)}`;
  const tail = activeId ? ` Currently on ${activeId}.` : "";
  return `${c.done} of ${c.total} units complete.${tail}${provenanceNote(c)}`;
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

  // ZERO units AND a read that failed is not an empty campaign — it is a
  // campaign we could not count. "This campaign has no units recorded yet."
  // is a fact, and we do not have it. (Reachable when campaign.md parses to no
  // table AND status.json is torn: the store still returns a campaign object,
  // so `unavailable` never fired and the empty phrasing did.)
  if (c.total === 0 && c.provenance.degraded) {
    return unavailable(
      "campaign_progress",
      "Campaign progress",
      "This campaign's records could not be read, so how far along it is could not be established.",
    );
  }
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

/**
 * The status sentence, with its basis attached.
 *
 * "It is running now." is a claim about the present, and it was being made from
 * whatever source happened to answer. The claim is still made — the fallback is
 * useful — but it now carries where it came from.
 */
function subIterateSummary(
  step: CampaignStepFacts,
  selectedBy: SubIterateSelection,
  c: CampaignFacts,
): string {
  const name = `${step.id} — ${step.title}`;
  // THIS unit's own source, not the campaign's. A campaign whose status.json
  // names S1 but not S2 reports `status_json` overall, and qualifying S2's
  // claim with that would vouch for a row the live file never mentioned
  // (external plan review, openai HIGH #5).
  const basis = provenanceNote(c, step.statusSource);
  switch (step.status) {
    case "in_progress":
      return `${name} is running now.${basis}`;
    case "complete":
      return selectedBy === "last_complete"
        ? `${name} was the last unit, and it is complete.${basis}`
        : `${name} is complete.${basis}`;
    case "failed":
      return `${name} failed and is what the campaign is waiting on.${basis}`;
    case "escalated":
      return `${name} was escalated for a human decision.${basis}`;
    default:
      return `${name} has not started yet.${basis}`;
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
    summary: subIterateSummary(step, selectedBy, fact.campaign),
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
