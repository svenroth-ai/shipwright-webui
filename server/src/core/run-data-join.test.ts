/*
 * run-data-join.test.ts — per-run data join (A02, campaign
 * webui-wow-usability-2026-07-10).
 *
 * RED on pre-A02 `main` (run-data-join.ts did not exist). Covers: present /
 * partial / absent / unknown-runId / NO-phase_timings (the honest-n/a common
 * case), the (phase, splitId) pipeline aggregation (never per-run attributed),
 * grade-trend fold, derived-gate honesty, and the graceful file wrappers.
 *
 * Fixtures use HEX `runId`/`adr_id` values — a non-hex id is rejected upstream
 * and the surface renders nothing (test-plan requirement).
 */

import { describe, it, expect } from "vitest";

import {
  aggregatePhaseTransitions,
  deriveGates,
  deriveTestGate,
  joinRunData,
  projectGradeTrend,
  projectPhaseDurations,
  projectRunData,
} from "./run-data-join.js";
import type { RunProjection, PhaseTransition } from "./event-log-reader.js";

const j = (o: unknown) => JSON.stringify(o);

const HEX_RUN = "iterate-2026-07-14-abc1234";
const HEX_ADR = "iterate-2026-07-14-abc1234";

function baseRun(over: Partial<RunProjection> = {}): RunProjection {
  return {
    runId: HEX_RUN,
    eventId: "evt-abc1234",
    ts: "2026-07-14T10:00:00Z",
    source: "iterate",
    intent: "feature",
    changeType: "feature",
    description: "d",
    summary: "s",
    commit: "deadbeef",
    specImpact: "Modify",
    affectedFrs: ["FR-01.47"],
    newFrs: [],
    tests: { passed: 10, total: 10 },
    phaseTimings: null,
    campaign: null,
    subIterateId: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// deriveTestGate / deriveGates — honest, flagged derived
// ---------------------------------------------------------------------------
describe("deriveTestGate", () => {
  // @covers FR-01.47
  it("pass when total>0 and passed===total", () => {
    expect(deriveTestGate({ passed: 10, total: 10 })).toBe("pass");
  });
  // @covers FR-01.47
  it("fail when passed<total", () => {
    expect(deriveTestGate({ passed: 9, total: 10 })).toBe("fail");
  });
  // @covers FR-01.47
  it("unknown when tests are null / total 0 / a mark absent", () => {
    expect(deriveTestGate(null)).toBe("unknown");
    expect(deriveTestGate({ passed: 0, total: 0 })).toBe("unknown");
    expect(deriveTestGate({ passed: null, total: 10 })).toBe("unknown");
  });
});

describe("deriveGates", () => {
  // @covers FR-01.47
  it("returns a derived-flagged object when tests are present", () => {
    const g = deriveGates(baseRun({ tests: { passed: 10, total: 10 } }));
    expect(g).toEqual({ derived: true, test: "pass", review: "unknown", security: "unknown" });
  });
  // @covers FR-01.47
  it("is null (nothing derivable) when the run carried no tests", () => {
    expect(deriveGates(baseRun({ tests: null }))).toBeNull();
  });
  // @covers FR-01.47
  it("never claims review/security pass — they stay unknown (honest)", () => {
    const g = deriveGates(baseRun({ tests: { passed: 3, total: 4 } }));
    expect(g?.review).toBe("unknown");
    expect(g?.security).toBe("unknown");
    expect(g?.test).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// projectPhaseDurations — iterate flat mark-list, honest null
// ---------------------------------------------------------------------------
describe("projectPhaseDurations", () => {
  // @covers FR-01.47
  it("returns null when phase_timings is absent (the common n/a case)", () => {
    expect(projectPhaseDurations(null)).toBeNull();
    expect(projectPhaseDurations(undefined)).toBeNull();
    expect(projectPhaseDurations([])).toBeNull();
  });
  // @covers FR-01.47
  it("projects a present iterate mark-list, reading duration_ms + started through", () => {
    const marks = [
      { phase: "scope", started: "2026-07-14T10:00:00Z", duration_ms: 1200 },
      { phase: "build", started: "2026-07-14T10:01:00Z", duration_ms: 5400 },
    ];
    expect(projectPhaseDurations(marks)).toEqual([
      { phase: "scope", startedAt: "2026-07-14T10:00:00Z", durationMs: 1200 },
      { phase: "build", startedAt: "2026-07-14T10:01:00Z", durationMs: 5400 },
    ]);
  });
  // @covers FR-01.47
  it("preserves a missing duration as null — never back-filled", () => {
    expect(projectPhaseDurations([{ phase: "review" }])).toEqual([
      { phase: "review", startedAt: null, durationMs: null },
    ]);
  });
  // @covers FR-01.47
  it("skips marks with no phase name; null when all unusable", () => {
    expect(projectPhaseDurations([{ duration_ms: 10 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// joinRunData — full shape + spec_impact normalization
// ---------------------------------------------------------------------------
describe("joinRunData", () => {
  // @covers FR-01.47
  it("joins the full run shape and lowercases spec_impact (raw preserved)", () => {
    const out = joinRunData(baseRun());
    expect(out.runId).toBe(HEX_RUN);
    expect(out.specImpact).toBe("modify");
    expect(out.specImpactRaw).toBe("Modify");
    expect(out.affectedFrs).toEqual(["FR-01.47"]);
    expect(out.tests).toEqual({ passed: 10, total: 10 });
    expect(out.gates).toEqual({ derived: true, test: "pass", review: "unknown", security: "unknown" });
    expect(out.phaseDurations).toBeNull();
  });
  // @covers FR-01.47
  it("partial run: absent fields degrade to null/[] and gates null", () => {
    const out = joinRunData(
      baseRun({ tests: null, specImpact: null, affectedFrs: [], summary: null }),
    );
    expect(out.gates).toBeNull();
    expect(out.specImpact).toBeNull();
    expect(out.affectedFrs).toEqual([]);
    expect(out.summary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregatePhaseTransitions — (phase, splitId), never per-run
// ---------------------------------------------------------------------------
function phase(over: Partial<PhaseTransition>): PhaseTransition {
  return { eventId: null, type: "phase_started", phase: "build", ts: null, splitId: null, detail: null, ...over };
}

describe("aggregatePhaseTransitions", () => {
  // @covers FR-01.47
  it("empty in → empty out", () => {
    expect(aggregatePhaseTransitions([])).toEqual([]);
  });
  // @covers FR-01.47
  it("pairs a single split's start+end into a duration", () => {
    const out = aggregatePhaseTransitions([
      phase({ type: "phase_started", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
      phase({ type: "phase_completed", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:10Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].phase).toBe("build");
    expect(out[0].splits[0].durationMs).toBe(10_000);
    expect(out[0].totalMs).toBe(10_000);
    expect(out[0].complete).toBe(true);
  });
  // @covers FR-01.47
  it("aggregates MULTIPLE splits of one phase — N ends, summed, never one-end-per-phase", () => {
    const out = aggregatePhaseTransitions([
      phase({ type: "phase_started", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
      phase({ type: "phase_completed", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:05Z" }),
      phase({ type: "phase_started", phase: "build", splitId: "s2", ts: "2026-07-14T10:00:00Z" }),
      phase({ type: "phase_completed", phase: "build", splitId: "s2", ts: "2026-07-14T10:00:07Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].splits).toHaveLength(2);
    expect(out[0].totalMs).toBe(12_000);
    expect(out[0].complete).toBe(true);
  });
  // @covers FR-01.47
  it("a started-only split has null duration and marks the phase incomplete", () => {
    const out = aggregatePhaseTransitions([
      phase({ type: "phase_started", phase: "test", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
    ]);
    expect(out[0].splits[0].durationMs).toBeNull();
    expect(out[0].totalMs).toBeNull();
    expect(out[0].complete).toBe(false);
  });
  // @covers FR-01.47
  it("phase_failed closes a split like phase_completed", () => {
    const out = aggregatePhaseTransitions([
      phase({ type: "phase_started", phase: "review", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
      phase({ type: "phase_failed", phase: "review", splitId: "s1", ts: "2026-07-14T10:00:03Z" }),
    ]);
    expect(out[0].splits[0].durationMs).toBe(3_000);
  });
  // @covers FR-01.47
  it("rejects a negative interval (end before start) as null — never a negative duration", () => {
    const out = aggregatePhaseTransitions([
      phase({ type: "phase_started", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:10Z" }),
      phase({ type: "phase_completed", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
    ]);
    expect(out[0].splits[0].durationMs).toBeNull();
    expect(out[0].totalMs).toBeNull();
    expect(out[0].complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// projectGradeTrend — grade_snapshot fold, chronological
// ---------------------------------------------------------------------------
describe("projectGradeTrend", () => {
  // @covers FR-01.47
  it("folds grade_snapshot events into an ascending {ts,grade,score} series", () => {
    const lines = [
      j({ type: "grade_snapshot", ts: "2026-07-14T12:00:00Z", grade: "A", score: 98.2 }),
      j({ type: "work_completed", adr_id: HEX_ADR }),
      j({ type: "grade_snapshot", ts: "2026-07-14T09:00:00Z", grade: "B+", score: 88 }),
    ];
    expect(projectGradeTrend(lines)).toEqual([
      { ts: "2026-07-14T09:00:00Z", grade: "B+", score: 88 },
      { ts: "2026-07-14T12:00:00Z", grade: "A", score: 98.2 },
    ]);
  });
  // @covers FR-01.47
  it("returns [] when there are no grade_snapshot events", () => {
    expect(projectGradeTrend([j({ type: "work_completed", adr_id: HEX_ADR })])).toEqual([]);
  });
  // @covers FR-01.47
  it("skips a torn line and a snapshot with no grade; score→null when absent", () => {
    const lines = [
      "{ this is torn",
      j({ type: "grade_snapshot", ts: "2026-07-14T09:00:00Z", score: 88 }),
      j({ type: "grade_snapshot", ts: "2026-07-14T10:00:00Z", grade: "A" }),
    ];
    expect(projectGradeTrend(lines)).toEqual([
      { ts: "2026-07-14T10:00:00Z", grade: "A", score: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// projectRunData — bundle wiring
// ---------------------------------------------------------------------------
describe("projectRunData", () => {
  // @covers FR-01.47
  it("bundles runs + gradeTrend + pipeline aggregate from one line pass", () => {
    const lines = [
      j({ type: "work_completed", adr_id: HEX_ADR, tests: { passed: 5, total: 5 }, spec_impact: "none" }),
      j({ type: "grade_snapshot", ts: "2026-07-14T09:00:00Z", grade: "A", score: 100 }),
      j({ type: "phase_started", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:00Z" }),
      j({ type: "phase_completed", phase: "build", splitId: "s1", ts: "2026-07-14T10:00:04Z" }),
    ];
    const b = projectRunData(lines);
    expect(b.runCount).toBe(1);
    expect(b.runs[0].runId).toBe(HEX_ADR);
    expect(b.gradeTrend).toHaveLength(1);
    expect(b.pipelinePhaseDurations[0].totalMs).toBe(4_000);
  });
  // @covers FR-01.47
  it("runId filter narrows runs to that single adr_id", () => {
    const lines = [
      j({ type: "work_completed", adr_id: HEX_ADR, tests: { passed: 1, total: 1 } }),
      j({ type: "work_completed", adr_id: "iterate-2026-07-14-def5678", tests: { passed: 2, total: 2 } }),
    ];
    const b = projectRunData(lines, { runId: HEX_ADR });
    expect(b.runCount).toBe(1);
    expect(b.runs[0].runId).toBe(HEX_ADR);
  });
});
