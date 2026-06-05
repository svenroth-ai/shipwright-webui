import { describe, it, expect } from "vitest";

import {
  selectActiveCampaigns,
  selectRiskyPendingSteps,
  isCampaignDone,
  type Campaign,
  type CampaignStep,
} from "./campaignsApi";

function makeStep(overrides: Partial<CampaignStep> = {}): CampaignStep {
  return {
    id: "B0",
    slug: "x",
    title: "X",
    status: "pending",
    specPath: ".shipwright/.../B0-x.md",
    commit: null,
    branch: null,
    planFirst: false,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    slug: "2026-06-02-x",
    intent: "do the thing",
    branchStrategy: "stacked",
    expandsTriage: null,
    status: null,
    steps: [],
    done: 0,
    total: 3,
    nextPending: { id: "B0", specPath: ".shipwright/.../B0-x.md" },
    ...overrides,
  };
}

describe("campaignsApi: selectActiveCampaigns", () => {
  it("status is authoritative: only `active` is shown; draft + complete hidden", () => {
    const active = makeCampaign({ slug: "active", status: "active", done: 0, total: 3 });
    const draft = makeCampaign({ slug: "draft", status: "draft", done: 0, total: 3 });
    const complete = makeCampaign({ slug: "complete", status: "complete", done: 3, total: 3 });
    const result = selectActiveCampaigns([active, draft, complete]);
    expect(result.map((c) => c.slug)).toEqual(["active"]);
  });

  it("draft is hidden even with work remaining (done < total)", () => {
    const draft = makeCampaign({ slug: "draft", status: "draft", done: 1, total: 3 });
    expect(selectActiveCampaigns([draft])).toEqual([]);
  });

  it("active is shown even when nothing is done yet (done=0)", () => {
    const active = makeCampaign({ slug: "active", status: "active", done: 0, total: 3 });
    expect(selectActiveCampaigns([active]).map((c) => c.slug)).toEqual(["active"]);
  });

  it("legacy (status=null) falls back to done < total", () => {
    const running = makeCampaign({ slug: "running", status: null, done: 1, total: 3 });
    const done = makeCampaign({ slug: "done", status: null, done: 3, total: 3 });
    const empty = makeCampaign({ slug: "empty", status: null, done: 0, total: 0 });
    const result = selectActiveCampaigns([running, done, empty]);
    expect(result.map((c) => c.slug)).toEqual(["running"]);
  });

  // Reported 2026-06-05: a campaign whose every step is complete (done==total)
  // but whose producer never flipped the lifecycle from `active` to `complete`
  // (e.g. driven via individual sub-iterate PRs instead of the autonomous
  // loop's update-status call) kept rendering forever — the old filter
  // short-circuited `active` → shown without checking done/total.
  it("hides an active campaign whose every step is done (stale `active` lifecycle)", () => {
    const activeDone = makeCampaign({
      slug: "compliance-detective-realign",
      status: "active",
      done: 4,
      total: 4,
    });
    expect(selectActiveCampaigns([activeDone])).toEqual([]);
  });

  it("user repro: a 4/4 active campaign + a 0/7 draft → the lane is empty", () => {
    const doneActive = makeCampaign({
      slug: "2026-06-02-compliance-detective-realign",
      status: "active",
      done: 4,
      total: 4,
    });
    const draft = makeCampaign({
      slug: "2026-06-02-hook-consolidation",
      status: "draft",
      done: 0,
      total: 7,
    });
    expect(selectActiveCampaigns([doneActive, draft])).toEqual([]);
  });

  it("still shows an active campaign with work remaining (done < total)", () => {
    const active = makeCampaign({ slug: "active", status: "active", done: 2, total: 4 });
    expect(selectActiveCampaigns([active]).map((c) => c.slug)).toEqual(["active"]);
  });

  it("shows a freshly-started active campaign that has no steps yet (total=0)", () => {
    const fresh = makeCampaign({ slug: "fresh", status: "active", done: 0, total: 0 });
    expect(selectActiveCampaigns([fresh]).map((c) => c.slug)).toEqual(["fresh"]);
  });
});

describe("campaignsApi: isCampaignDone", () => {
  it("is done when the producer marked it complete", () => {
    expect(isCampaignDone(makeCampaign({ status: "complete", done: 0, total: 3 }))).toBe(true);
  });

  it("is done when every step is finished, regardless of a stale active lifecycle", () => {
    expect(isCampaignDone(makeCampaign({ status: "active", done: 3, total: 3 }))).toBe(true);
    expect(isCampaignDone(makeCampaign({ status: null, done: 3, total: 3 }))).toBe(true);
  });

  it("is NOT done with work remaining or no steps yet", () => {
    expect(isCampaignDone(makeCampaign({ status: "active", done: 2, total: 3 }))).toBe(false);
    expect(isCampaignDone(makeCampaign({ status: "active", done: 0, total: 0 }))).toBe(false);
    expect(isCampaignDone(makeCampaign({ status: "draft", done: 0, total: 3 }))).toBe(false);
  });
});

describe("campaignsApi: selectRiskyPendingSteps", () => {
  it("flags non-complete steps that are failed / escalated / plan-first", () => {
    const c = makeCampaign({
      steps: [
        makeStep({ id: "B0", status: "complete" }), // complete → never risky
        makeStep({ id: "B1", status: "failed" }),
        makeStep({ id: "B2", status: "escalated" }),
        makeStep({ id: "B3", status: "pending", planFirst: true }),
        makeStep({ id: "B4", status: "pending", planFirst: false }), // clean pending
        makeStep({ id: "B5", status: "in_progress", planFirst: false }),
      ],
    });
    expect(selectRiskyPendingSteps(c).map((s) => s.id)).toEqual(["B1", "B2", "B3"]);
  });

  it("a complete step is never risky even if plan-first", () => {
    const c = makeCampaign({
      steps: [makeStep({ id: "B0", status: "complete", planFirst: true })],
    });
    expect(selectRiskyPendingSteps(c)).toEqual([]);
  });

  it("returns [] for an all-clean-pending campaign", () => {
    const c = makeCampaign({
      steps: [makeStep({ id: "B0" }), makeStep({ id: "B1", status: "in_progress" })],
    });
    expect(selectRiskyPendingSteps(c)).toEqual([]);
  });
});
