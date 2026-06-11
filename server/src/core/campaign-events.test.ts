import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  projectCampaignEvents,
  readCampaignEvents,
  applyEventsProjection,
} from "./campaign-events.js";
import type { Campaign, CampaignStep } from "./campaign-store.js";

// ---- fixtures -------------------------------------------------------------

function evt(o: Record<string, unknown>): string {
  return JSON.stringify({ type: "work_completed", v: 1, ...o });
}

function makeStep(over: Partial<CampaignStep> = {}): CampaignStep {
  return {
    id: "C1",
    slug: "alpha",
    title: "Alpha",
    status: "pending",
    specPath: ".shipwright/planning/iterate/campaigns/x/sub-iterates/C1-alpha.md",
    commit: null,
    branch: null,
    planFirst: false,
    ...over,
  };
}

function makeCampaign(over: Partial<Campaign> = {}): Campaign {
  const steps = over.steps ?? [makeStep()];
  return {
    slug: "2026-06-10-x",
    intent: "do x",
    branchStrategy: "stacked",
    expandsTriage: null,
    status: "active",
    steps,
    done: steps.filter((s) => s.status === "complete").length,
    total: steps.length,
    nextPending: null,
    ...over,
  };
}

// ---- projectCampaignEvents -----------------------------------------------

describe("campaign-events: projectCampaignEvents", () => {
  it("groups work_completed by top-level campaign, carrying commit (tests ignored — no board surface)", () => {
    const lines = [
      evt({ campaign: "2026-06-10-x", sub_iterate_id: "C1", commit: "aaa", ts: "2026-06-10T01:00:00Z", tests: { passed: 5, total: 6 } }),
      evt({ campaign: "2026-06-10-x", sub_iterate_id: "C2", commit: "bbb", ts: "2026-06-10T02:00:00Z" }),
    ];
    const proj = projectCampaignEvents(lines);
    expect([...proj.keys()]).toEqual(["2026-06-10-x"]);
    const x = proj.get("2026-06-10-x")!;
    expect(x.get("C1")).toEqual({ commit: "aaa" });
    expect(x.get("C2")).toEqual({ commit: "bbb" });
  });

  it("ignores non-work_completed, missing campaign, and missing sub_iterate_id", () => {
    const lines = [
      JSON.stringify({ type: "phase_completed", campaign: "x", sub_iterate_id: "C1" }),
      evt({ sub_iterate_id: "C1", commit: "z" }), // no campaign
      evt({ campaign: "x", commit: "z" }), // no sub_iterate_id
      evt({ campaign: "x", sub_iterate_id: "", commit: "z" }), // falsy sid
    ];
    expect(projectCampaignEvents(lines).size).toBe(0);
  });

  it("latest event wins per sub_iterate_id (ts epoch, then file-index)", () => {
    const lines = [
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "old", ts: "2026-06-10T01:00:00Z" }),
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "new", ts: "2026-06-10T05:00:00Z" }),
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "stale", ts: "2026-06-10T03:00:00Z" }),
    ];
    expect(projectCampaignEvents(lines).get("x")!.get("C1")!.commit).toBe("new");
  });

  it("file-index breaks ties when ts is equal or unparseable", () => {
    const lines = [
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "first" }), // no ts
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "last" }), // no ts → later index wins
    ];
    expect(projectCampaignEvents(lines).get("x")!.get("C1")!.commit).toBe("last");
  });

  it("tolerates corrupt lines, blanks, and non-object JSON", () => {
    const lines = [
      "not json",
      "",
      "42",
      "[1,2,3]",
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "ok" }),
    ];
    const proj = projectCampaignEvents(lines);
    expect(proj.get("x")!.get("C1")!.commit).toBe("ok");
  });
});

// ---- applyEventsProjection: overlay (campaign dir present) -----------------

describe("campaign-events: applyEventsProjection — overlay", () => {
  it("bumps a pending step to complete and recomputes done/nextPending", () => {
    const campaign = makeCampaign({
      slug: "x",
      steps: [
        makeStep({ id: "C1", status: "complete" }),
        makeStep({ id: "C2", status: "pending" }),
      ],
      done: 1,
      total: 2,
      nextPending: { id: "C2", specPath: "p" },
    });
    const proj = projectCampaignEvents([
      evt({ campaign: "x", sub_iterate_id: "C2", commit: "ccc", tests: { passed: 9, total: 9 } }),
    ]);
    const [out] = applyEventsProjection([campaign], proj);
    expect(out.steps.find((s) => s.id === "C2")!.status).toBe("complete");
    expect(out.steps.find((s) => s.id === "C2")!.commit).toBe("ccc");
    expect(out.done).toBe(2);
    expect(out.nextPending).toBeNull();
    expect(out.derivedFromEvents).toBeFalsy();
  });

  it("never downgrades: complete stays complete with no event; failed is superseded by a complete event", () => {
    const campaign = makeCampaign({
      slug: "x",
      steps: [
        makeStep({ id: "C1", status: "complete", commit: "keep" }),
        makeStep({ id: "C2", status: "failed" }),
      ],
      done: 1,
      total: 2,
    });
    const proj = projectCampaignEvents([
      evt({ campaign: "x", sub_iterate_id: "C2", commit: "rerun" }),
    ]);
    const [out] = applyEventsProjection([campaign], proj);
    expect(out.steps.find((s) => s.id === "C1")!.status).toBe("complete");
    expect(out.steps.find((s) => s.id === "C1")!.commit).toBe("keep"); // no event → untouched
    expect(out.steps.find((s) => s.id === "C2")!.status).toBe("complete"); // supersede
  });

  it("does NOT touch a step with no matching event; empty event commit never clobbers a real one", () => {
    const campaign = makeCampaign({
      slug: "x",
      steps: [makeStep({ id: "C1", status: "pending", commit: "local" })],
      done: 0,
      total: 1,
    });
    const proj = projectCampaignEvents([
      evt({ campaign: "x", sub_iterate_id: "C1", commit: "" }), // empty commit
    ]);
    const [out] = applyEventsProjection([campaign], proj);
    expect(out.steps[0].status).toBe("complete"); // event present → complete
    expect(out.steps[0].commit).toBe("local"); // empty event commit must not clobber
  });

  it("leaves campaigns untouched when there are no events", () => {
    const campaign = makeCampaign({ slug: "x" });
    const out = applyEventsProjection([campaign], new Map());
    expect(out).toHaveLength(1);
    expect(out[0].derivedFromEvents).toBeFalsy();
    expect(out[0].steps[0].status).toBe("pending");
  });
});

// ---- applyEventsProjection: synthesize (campaign dir absent) ---------------

describe("campaign-events: applyEventsProjection — synthesize", () => {
  it("builds a derived campaign for an events-only slug (all steps complete, no skeleton)", () => {
    const proj = projectCampaignEvents([
      evt({ campaign: "2026-06-10-ghost", sub_iterate_id: "C2", commit: "two", tests: { passed: 3, total: 3 } }),
      evt({ campaign: "2026-06-10-ghost", sub_iterate_id: "C10", commit: "ten" }),
    ]);
    const out = applyEventsProjection([], proj);
    expect(out).toHaveLength(1);
    const g = out[0];
    expect(g.slug).toBe("2026-06-10-ghost");
    expect(g.derivedFromEvents).toBe(true);
    expect(g.status).toBeNull();
    expect(g.total).toBe(2);
    expect(g.done).toBe(2);
    expect(g.nextPending).toBeNull();
    // numeric-aware order: C2 before C10
    expect(g.steps.map((s) => s.id)).toEqual(["C2", "C10"]);
    expect(g.steps.every((s) => s.status === "complete")).toBe(true);
    expect(g.steps[0].commit).toBe("two");
    expect(g.steps[0].specPath).toBeNull(); // no skeleton → launch disabled
    expect(g.steps[0].title).toBe("C2"); // id as title fallback
  });

  it("does NOT synthesize a slug that already exists locally (overlay path owns it)", () => {
    const local = makeCampaign({ slug: "x", steps: [makeStep({ id: "C1", status: "pending" })], done: 0, total: 1 });
    const proj = projectCampaignEvents([evt({ campaign: "x", sub_iterate_id: "C1", commit: "c" })]);
    const out = applyEventsProjection([local], proj);
    expect(out).toHaveLength(1);
    expect(out[0].derivedFromEvents).toBeFalsy();
    expect(out[0].steps[0].status).toBe("complete");
  });

  it("sorts locals + synthesized together by slug descending", () => {
    const local = makeCampaign({ slug: "2026-06-09-local", steps: [makeStep({ id: "C1" })], done: 0, total: 1 });
    const proj = projectCampaignEvents([
      evt({ campaign: "2026-06-11-ghost", sub_iterate_id: "C1", commit: "c" }),
      evt({ campaign: "2026-06-08-old", sub_iterate_id: "C1", commit: "c" }),
    ]);
    const out = applyEventsProjection([local], proj);
    expect(out.map((c) => c.slug)).toEqual(["2026-06-11-ghost", "2026-06-09-local", "2026-06-08-old"]);
  });
});

// ---- readCampaignEvents (file-loading wrapper) ----------------------------

describe("campaign-events: readCampaignEvents", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "campaign-events-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty projection when the log is absent", () => {
    expect(readCampaignEvents(dir).size).toBe(0);
  });

  it("reads <projectRoot>/shipwright_events.jsonl line-by-line", () => {
    writeFileSync(
      path.join(dir, "shipwright_events.jsonl"),
      [
        evt({ campaign: "x", sub_iterate_id: "C1", commit: "aaa" }),
        "garbage line",
        evt({ campaign: "x", sub_iterate_id: "C2", commit: "bbb" }),
      ].join("\n"),
      "utf-8",
    );
    const proj = readCampaignEvents(dir);
    expect(proj.get("x")!.size).toBe(2);
    expect(proj.get("x")!.get("C2")!.commit).toBe("bbb");
  });
});
