/*
 * campaign-artifacts.test.ts — S3 AC1 (campaign half).
 *
 * Two properties carry this file:
 *   1. campaign-LEVEL and sub-iterate-LEVEL artifacts stay DISTINCT. A reader who
 *      mistakes one unit's commit for the campaign's has been misled, so the
 *      separation is asserted, not assumed.
 *   2. an unreadable store never renders as an empty campaign. This is the third
 *      appearance of that failure shape in this campaign (S1's frozen merge
 *      state, S2's folded findings count), so it is pinned per artifact.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import {
  buildCampaignBriefArtifact,
  buildCampaignProgressArtifact,
  buildRunbookArtifact,
  buildSubIterateArtifact,
  selectActiveStep,
  type CampaignFact,
  type CampaignStepFacts,
} from "./campaign-artifacts.js";

function step(over: Partial<CampaignStepFacts> = {}): CampaignStepFacts {
  return {
    id: "S1",
    title: "resolver core",
    status: "complete",
    specPath: ".shipwright/planning/iterate/campaigns/c/sub-iterates/S1-resolver.md",
    commit: "66e275ae",
    branch: "iterate/campaign-S1",
    testsPassed: 5107,
    testsTotal: 5108,
    ...over,
  };
}

function ok(steps: CampaignStepFacts[], over: Partial<CampaignFact & { x: never }> = {}): CampaignFact {
  return {
    status: "ok",
    campaign: {
      slug: "2026-07-18-mission-artifacts",
      intent: "Make Mission answer what a change did.",
      lifecycle: "active",
      branchStrategy: "serial",
      done: steps.filter((s) => s.status === "complete").length,
      total: steps.length,
      steps,
    },
    ...(over as object),
  };
}

const UNAVAILABLE: CampaignFact = { status: "unavailable" };

describe("selectActiveStep — the rule, and its stated basis", () => {
  it("picks the unit explicitly in progress", () => {
    const picked = selectActiveStep([
      step({ id: "S1", status: "complete" }),
      step({ id: "S2", status: "in_progress" }),
      step({ id: "S3", status: "pending" }),
    ]);
    expect(picked?.step.id).toBe("S2");
    expect(picked?.selectedBy).toBe("in_progress");
  });

  it("falls back to the first unit that is not complete", () => {
    const picked = selectActiveStep([
      step({ id: "S1", status: "complete" }),
      step({ id: "S2", status: "pending" }),
      step({ id: "S3", status: "pending" }),
    ]);
    expect(picked?.step.id).toBe("S2");
    expect(picked?.selectedBy).toBe("first_incomplete");
  });

  it("treats a FAILED unit as the active one — a stuck unit must not be skipped", () => {
    const picked = selectActiveStep([
      step({ id: "S1", status: "failed" }),
      step({ id: "S2", status: "pending" }),
    ]);
    expect(picked?.step.id).toBe("S1");
  });

  it("treats an ESCALATED unit as the active one", () => {
    const picked = selectActiveStep([
      step({ id: "S1", status: "complete" }),
      step({ id: "S2", status: "escalated" }),
    ]);
    expect(picked?.step.id).toBe("S2");
  });

  it("prefers an in-progress unit even when an EARLIER one failed", () => {
    // The rule is deliberately not "first non-complete wins" — an operator who
    // re-ran past a failure is looking at what is running NOW.
    const picked = selectActiveStep([
      step({ id: "S1", status: "failed" }),
      step({ id: "S2", status: "in_progress" }),
    ]);
    expect(picked?.step.id).toBe("S2");
    expect(picked?.selectedBy).toBe("in_progress");
  });

  it("shows the LAST unit once everything is complete", () => {
    const picked = selectActiveStep([
      step({ id: "S1", status: "complete" }),
      step({ id: "S2", status: "complete" }),
    ]);
    expect(picked?.step.id).toBe("S2");
    expect(picked?.selectedBy).toBe("last_complete");
  });

  it("returns null for a campaign with no units", () => {
    expect(selectActiveStep([])).toBeNull();
  });
});

describe("campaign-LEVEL artifacts", () => {
  const doc = { documentId: "opaque-id", title: "campaign.md" };

  it("the brief leads with the campaign's own intent", () => {
    const a = buildCampaignBriefArtifact(ok([step()]), doc);
    expect(a.state).toBe("available");
    expect(a.summary).toBe("Make Mission answer what a change did.");
    expect(a.detail?.documentId).toBe("opaque-id");
  });

  it("the brief is NOT_YET_CREATED when the campaign has no campaign.md", () => {
    expect(buildCampaignBriefArtifact(ok([step()]), null).state).toBe("not_yet_created");
  });

  it("a runbook-less campaign hides the runbook rather than showing a dead entry", () => {
    expect(buildRunbookArtifact(ok([step()]), null).state).toBe("not_applicable");
  });

  it("progress reports done/total and names the active unit", () => {
    const a = buildCampaignProgressArtifact(
      ok([step({ id: "S1" }), step({ id: "S2", status: "in_progress" })]),
      "S2",
    );
    expect(a.state).toBe("available");
    expect(a.receipt).toBe("1/2 complete");
    expect(a.summary).toContain("Currently on S2");
    expect(a.detail?.rows.find((r) => r.id === "S2")?.active).toBe(true);
    expect(a.detail?.rows.find((r) => r.id === "S1")?.active).toBe(false);
  });

  it("progress says so plainly when every unit is complete", () => {
    const steps = [step({ id: "S1" }), step({ id: "S2" })];
    expect(buildCampaignProgressArtifact(ok(steps), "S2").summary).toBe("All 2 units are complete.");
  });

  it("EXACTLY ONE row is marked active", () => {
    const a = buildCampaignProgressArtifact(
      ok([step({ id: "S1" }), step({ id: "S2", status: "in_progress" }), step({ id: "S3", status: "pending" })]),
      "S2",
    );
    expect(a.detail?.rows.filter((r) => r.active)).toHaveLength(1);
  });
});

describe("sub-iterate-LEVEL artifact", () => {
  it("carries the ACTIVE unit's own commit, branch and spec — not the campaign's", () => {
    const fact = ok([
      step({ id: "S1", status: "complete", commit: "aaaa1111", branch: "iterate/S1" }),
      step({ id: "S2", status: "in_progress", commit: null, branch: "iterate/S2", testsPassed: null, testsTotal: null }),
    ]);
    const a = buildSubIterateArtifact(fact, { documentId: "sub-doc", title: "S2-tests.md" });

    expect(a.detail?.id).toBe("S2");
    expect(a.detail?.selectedBy).toBe("in_progress");
    expect(a.detail?.branch).toBe("iterate/S2");
    // The COMPLETED unit's commit must not leak onto the running one.
    expect(a.detail?.commit).toBeNull();
    expect(a.detail?.documentId).toBe("sub-doc");
  });

  it("keeps unrecorded test counts NULL — never zero", () => {
    const a = buildSubIterateArtifact(
      ok([step({ status: "in_progress", testsPassed: null, testsTotal: null })]),
      null,
    );
    expect(a.detail?.testsPassed).toBeNull();
    expect(a.detail?.testsTotal).toBeNull();
  });

  it("says a failed unit is what the campaign is waiting on", () => {
    const a = buildSubIterateArtifact(ok([step({ id: "S2", status: "failed" })]), null);
    expect(a.summary).toContain("failed");
    expect(a.summary).toContain("waiting on");
  });

  it("is available WITHOUT a spec document — the unit is still a real fact", () => {
    const a = buildSubIterateArtifact(ok([step({ status: "in_progress", specPath: null })]), null);
    expect(a.state).toBe("available");
    expect(a.detail?.documentId).toBeNull();
  });

  it("hides only when the record parsed and genuinely lists no units", () => {
    expect(buildSubIterateArtifact(ok([]), null).state).toBe("not_applicable");
  });
});

describe("an unreadable store is NEVER an empty campaign", () => {
  it.each([
    ["brief", () => buildCampaignBriefArtifact(UNAVAILABLE, null)],
    ["runbook", () => buildRunbookArtifact(UNAVAILABLE, null)],
    ["progress", () => buildCampaignProgressArtifact(UNAVAILABLE, null)],
    ["sub-iterate", () => buildSubIterateArtifact(UNAVAILABLE, null)],
  ])("%s renders `unavailable` (visible) with a stated reason", (_name, build) => {
    const a = build();
    // `unavailable` is a SHOWN state; `not_applicable`/`not_yet_created` hide.
    expect(a.state).toBe("unavailable");
    expect(a.note).toBeTruthy();
    expect(a.detail).toBeNull();
  });

  it("progress does NOT report 0/0 when the store could not be read", () => {
    const a = buildCampaignProgressArtifact(UNAVAILABLE, null);
    expect(a.receipt).toBeNull();
    expect(a.detail).toBeNull();
  });
});
