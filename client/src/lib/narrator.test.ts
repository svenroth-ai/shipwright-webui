/*
 * narrator.test.ts — pins the deterministic event → plain-language mapping
 * (FR-01.54, A10, campaign webui-wow-usability-2026-07-10). Expected strings
 * are INDEPENDENT literals (never imported from narrator.ts) so a paraphrase
 * flips a red, lifted verbatim from the prototype copy-of-record incl. real
 * code points (U+201C/U+201D/U+2019/U+2014/U+2192/U+00B7) — byte-identical.
 */
import { describe, it, expect } from "vitest";

import {
  buildPipelineRail,
  buildIterateRail,
  narratePipelinePhase,
  narrateIteratePhase,
  narrateVerdict,
  narrateMission,
  narrateRecord,
  isPipelinePhase,
  SECURITY_IS_PIPELINE_PHASE,
  type IteratePhaseInput,
  type RunFactsLike,
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

/* ---- Verdict banner (AC1 verbatim) ------------------------------------ */
describe("verdict banner", () => {
  it("renders ALL CLEAR and GATE HOLD verbatim with slots filled", () => {
    expect(
      narrateVerdict({ outcome: "clear", tests: { passed: 12, total: 12 } }),
    ).toBe("ALL CLEAR — security · 12/12 tests · review clean");
    expect(
      narrateVerdict({
        outcome: "hold",
        detail: "token written to a log line in plain text",
      }),
    ).toBe(
      "GATE HOLD — Security · token written to a log line in plain text — fixing.",
    );
  });
});

/* ---- Mission lines (AC1 verbatim) ------------------------------------- */
describe("mission lines", () => {
  it("emits the complete / hold / designgate lines verbatim", () => {
    expect(
      narrateMission({ state: "complete", changeCount: 1, fileCount: 4, allGreen: true }),
    ).toEqual({ text: "Done.", emphasis: "1 change, 4 files, every check green." });
    expect(narrateMission({ state: "hold" })).toEqual({
      text: "The security gate caught something.",
      emphasis: "The change can’t ship until this is green.",
    });
    expect(narrateMission({ state: "designgate", screenCount: 5 })).toEqual({
      text: "5 screens are ready for your eyes.",
      emphasis: "Nothing gets built until you approve.",
    });
  });

  it("narrates a real zero (strict null check, not falsiness)", () => {
    // 0 is a read value, not "absent" — it must appear, not be dropped.
    expect(
      narrateMission({ state: "complete", changeCount: 0, fileCount: 0 }).emphasis,
    ).toBe("0 changes, 0 files");
    expect(narrateMission({ state: "designgate", screenCount: 0 }).text).toBe(
      "0 screens are ready for your eyes.",
    );
  });
});

/* ---- The Record captions (AC1 verbatim) + receipts -------------------- */
describe("The Record node captions", () => {
  const facts: RunFactsLike = {
    affectedFrs: ["FR-01.28"],
    specImpact: "modify",
    tests: { passed: 2041, total: 2041 },
    gates: { review: "pass" },
    commit: "ac845a1f9c",
  };

  it("emits the 5 nodes with verbatim captions", () => {
    const byKey = Object.fromEntries(narrateRecord(facts).map((n) => [n.key, n]));
    expect(byKey.req.label).toBe("Requirement");
    expect(byKey.req.receipt).toBe("FR-01.28");
    expect(byKey.req.caption).toBe(
      "Everything below must trace to this requirement — or the change does not ship. This is the anchor of the audit trail.",
    );
    expect(byKey.spec.caption).toBe(
      "The written definition of “done”, diffed on this run.",
    );
    expect(byKey.tests.caption).toBe("Suite 2041/2041 green.");
    expect(byKey.tests.receipt).toBe("2041/2041");
    expect(byKey.review.caption).toBe("The verdict that let the change proceed.");
    expect(byKey.review.receipt).toBe("clean");
    expect(byKey.commit.caption).toBe(
      "Spec · changelog · decision log moved in lockstep.",
    );
    expect(byKey.commit.receipt).toBe("ac845a1");
  });
});

/* ---- AC3: honest degradation on a fields-stripped fixture ------------- */
describe("honest degradation (no fabricated numbers/counts/outcomes)", () => {
  const stripped: RunFactsLike = {
    affectedFrs: [],
    specImpact: null,
    tests: null,
    gates: null,
    commit: null,
  };

  /** All narrated strings for a stripped run — used to scan for fabrication. */
  function strippedStrings(): string[] {
    const rec = narrateRecord(stripped);
    const out: string[] = [];
    for (const n of rec) out.push(n.receipt, n.caption);
    out.push(narrateVerdict({ outcome: "clear", tests: null }));
    out.push(narrateVerdict({ outcome: "hold", detail: null }));
    const m = narrateMission({ state: "complete" });
    out.push(m.text, m.emphasis);
    const dg = narrateMission({ state: "designgate", screenCount: null });
    out.push(dg.text, dg.emphasis);
    return out;
  }

  it("never emits a digit it did not read", () => {
    for (const s of strippedStrings()) {
      expect(s).not.toMatch(/[0-9]/);
    }
  });

  it("degrades unknown receipts to an explicit n/a", () => {
    const byKey = Object.fromEntries(narrateRecord(stripped).map((n) => [n.key, n]));
    expect(byKey.req.receipt).toBe("n/a");
    expect(byKey.tests.receipt).toBe("n/a");
    expect(byKey.tests.caption).toBe("Suite n/a.");
    expect(byKey.review.receipt).toBe("n/a");
    expect(byKey.commit.receipt).toBe("n/a");
  });

  it("drops the test clause from a clear verdict when tests are unknown", () => {
    expect(narrateVerdict({ outcome: "clear", tests: null })).toBe(
      "ALL CLEAR — security · review clean",
    );
  });

  it("drops the security-detail clause from a hold verdict when unknown", () => {
    expect(narrateVerdict({ outcome: "hold", detail: null })).toBe(
      "GATE HOLD — Security — fixing.",
    );
  });

  it("complete mission without counts is just Done.", () => {
    expect(narrateMission({ state: "complete" })).toEqual({
      text: "Done.",
      emphasis: "",
    });
  });

  it("designgate without a count omits the number", () => {
    expect(narrateMission({ state: "designgate", screenCount: null })).toEqual({
      text: "Screens are ready for your eyes.",
      emphasis: "Nothing gets built until you approve.",
    });
  });
});
