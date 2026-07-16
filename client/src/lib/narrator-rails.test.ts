/*
 * narrator-rails.test.ts — pins the two phase RAILS (FR-01.54, A10, campaign
 * webui-wow-usability-2026-07-10): the 7-node pipeline rail (NO secure node)
 * and the 5-node iterate display grouping DERIVED from sessionPlan.phases[].group.
 * Split out of narrator.test.ts to keep both files <=300 LOC. Glosses are
 * INDEPENDENT literals lifted verbatim from Spec/prototype/wizard.js + data.js.
 */
import { describe, it, expect } from "vitest";

import {
  buildPipelineRail,
  buildIterateRail,
  narratePipelinePhase,
  narrateIteratePhase,
  isPipelinePhase,
  SECURITY_IS_PIPELINE_PHASE,
  type IteratePhaseInput,
} from "./narrator";

/* Real sessionPlan.phases[].group mapping from Spec/prototype/data.js. */
const REAL_ITERATE_PHASES: IteratePhaseInput[] = [
  { id: "repo_scout", group: "scope" },
  { id: "interview", group: "scope" },
  { id: "iterate_spec", group: "scope" },
  { id: "build", group: "build" },
  { id: "external_plan_review", group: "review" },
  { id: "self_review", group: "review" },
  { id: "code_review", group: "review" },
  { id: "confidence_calibration", group: "review" },
  { id: "test", group: "test" },
  { id: "finalize", group: "finalize" },
];

/* ---- Pipeline rail: 7 nodes, NO secure node (AC2) --------------------- */
describe("pipeline rail (7 phases, no secure node)", () => {
  it("has exactly the 7 approved phases in order", () => {
    const rail = buildPipelineRail();
    expect(rail.map((n) => n.id)).toEqual([
      "project",
      "design",
      "plan",
      "build",
      "test",
      "changelog",
      "deploy",
    ]);
  });

  it("includes changelog and does NOT include a secure/security node", () => {
    const ids = buildPipelineRail().map((n) => n.id);
    expect(ids).toContain("changelog");
    expect(ids).not.toContain("secure");
    expect(ids).not.toContain("security");
    expect(SECURITY_IS_PIPELINE_PHASE).toBe(false);
    expect(isPipelinePhase("secure")).toBe(false);
    expect(isPipelinePhase("security")).toBe(false);
    expect(isPipelinePhase("build")).toBe(true);
  });

  it("lifts each phase gloss verbatim from wizard.js planCard()", () => {
    const byId = Object.fromEntries(buildPipelineRail().map((n) => [n.id, n]));
    expect(byId.project.label).toBe("Project");
    expect(byId.project.gloss).toBe(
      "First I write down what “done” means — that’s your spec.",
    );
    expect(byId.design.gloss).toBe(
      "I mock the screens so you can approve the look before code exists.",
    );
    expect(byId.plan.gloss).toBe("I break the work into small, testable pieces.");
    expect(byId.build.gloss).toBe(
      "Tests first (they prove it works), then the code to pass them.",
    );
    expect(byId.test.gloss).toBe(
      "The full suite runs — the red→green moment is the proof.",
    );
    expect(byId.changelog.gloss).toBe(
      "Every change is written up so the record stays honest.",
    );
    expect(byId.deploy.gloss).toBe(
      "I ship it to the web (I’ll ask for env vars here).",
    );
  });

  it("uses the local deploy gloss when the target is local", () => {
    const rail = buildPipelineRail({ deployTarget: "local" });
    const deploy = rail.find((n) => n.id === "deploy");
    expect(deploy?.gloss).toBe(
      "Skipped — it runs on your machine for now.",
    );
  });

  it("narratePipelinePhase returns the same gloss deterministically", () => {
    const a = narratePipelinePhase("test");
    const b = narratePipelinePhase("test");
    expect(a).toEqual(b);
    expect(a?.gloss).toBe(
      "The full suite runs — the red→green moment is the proof.",
    );
    expect(narratePipelinePhase("secure")).toBeNull();
  });
});

/* ---- Iterate rail: 5 display groups derived from phases[].group (AC2) - */
describe("iterate rail (5-node display grouping from sessionPlan.phases[].group)", () => {
  it("collapses the ~10 real phases to 5 ordered groups", () => {
    const rail = buildIterateRail(REAL_ITERATE_PHASES);
    expect(rail.map((n) => n.group)).toEqual([
      "scope",
      "build",
      "review",
      "test",
      "finalize",
    ]);
    expect(rail.map((n) => n.label)).toEqual([
      "Scope",
      "Build",
      "Review",
      "Test",
      "Finalize",
    ]);
  });

  it("is DERIVED, not hardcoded — a group's member phases come from input", () => {
    const rail = buildIterateRail(REAL_ITERATE_PHASES);
    const review = rail.find((n) => n.group === "review");
    expect(review?.phases).toEqual([
      "external_plan_review",
      "self_review",
      "code_review",
      "confidence_calibration",
    ]);
    const scope = rail.find((n) => n.group === "scope");
    expect(scope?.phases).toEqual(["repo_scout", "interview", "iterate_spec"]);
  });

  it("orders a re-ordered/partial plan by the canonical iterateGroups order", () => {
    const rail = buildIterateRail([
      { id: "finalize", group: "finalize" },
      { id: "build", group: "build" },
      { id: "test", group: "test" },
      { id: "build2", group: "build" },
    ]);
    // input order finalize,build,test → canonical build<test<finalize; build
    // still folds its two derived phases.
    expect(rail.map((n) => n.group)).toEqual(["build", "test", "finalize"]);
    expect(rail.find((n) => n.group === "build")?.phases).toEqual([
      "build",
      "build2",
    ]);
  });

  it("never injects an unknown group (e.g. a stray secure) as a rail node", () => {
    const rail = buildIterateRail([
      { id: "secure_scan", group: "secure" },
      { id: "build", group: "build" },
      { id: "repo_scout", group: "scope" },
    ]);
    // The rail is limited to the authoritative five groups in canonical order;
    // a non-canonical "secure" group is NOT a 6th node — security is never an
    // iterate phase.
    expect(rail.map((n) => n.group)).toEqual(["scope", "build"]);
    expect(rail.map((n) => n.group)).not.toContain("secure");
  });

  it("narrateIteratePhase maps a phase to its display group", () => {
    expect(narrateIteratePhase({ id: "code_review", group: "review" })).toEqual({
      group: "review",
      label: "Review",
    });
  });
});

describe("narrateIteratePhase group validation (matches buildIterateRail)", () => {
  it("returns null for a non-canonical group instead of a 'Secure' label", () => {
    expect(narrateIteratePhase({ id: "secure_scan", group: "secure" })).toBeNull();
  });
});
