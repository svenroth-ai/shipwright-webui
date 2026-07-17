import { describe, it, expect } from "vitest";

import { buildProjectLogModel, statsLine } from "./projectLogStats";
import type { RunDataJoin, RunsResponse } from "./runDataApi";

function run(partial: Partial<RunDataJoin>): RunDataJoin {
  return {
    runId: "iterate-2026-07-15-x",
    ts: null,
    source: null,
    intent: null,
    changeType: null,
    summary: null,
    description: null,
    commit: null,
    specImpact: null,
    specImpactRaw: null,
    affectedFrs: [],
    newFrs: [],
    tests: null,
    gates: null,
    phaseDurations: null,
    campaign: null,
    subIterateId: null,
    ...partial,
  };
}

function bundle(partial: Partial<RunsResponse>): RunsResponse {
  return {
    status: "ok",
    runs: [],
    runCount: 0,
    gradeTrend: [],
    pipelinePhaseDurations: [],
    skippedLines: 0,
    ...partial,
  };
}

describe("buildProjectLogModel — provenance honesty (AC3)", () => {
  // @covers FR-01.59
  it("returns { graded: false } for undefined (no A02 payload)", () => {
    const m = buildProjectLogModel(undefined, 92);
    expect(m.graded).toBe(false);
    expect(m.runs).toBe(0);
    expect(m.spark).toEqual([]);
    expect(m.lastProof).toBeNull();
  });

  // @covers FR-01.59
  it("returns { graded: false } for an EMPTY payload (runCount 0) — the honest-degradation case", () => {
    const m = buildProjectLogModel(bundle({ runCount: 0, runs: [] }), 88);
    // Zero runs must NOT synthesize a score/sparkline even if compliance exists.
    expect(m).toEqual({
      graded: false,
      runs: 0,
      frCount: 0,
      score: null,
      spark: [],
      lastProof: null,
    });
  });

  // @covers FR-01.59
  it("a positive runCount with an EMPTY runs array is NOT graded (no body to render)", () => {
    // Defensive: the server keeps runCount === runs.length, but a graded card
    // must never claim runs it cannot show.
    const m = buildProjectLogModel(bundle({ runCount: 3, runs: [] }), 70);
    expect(m.graded).toBe(false);
    expect(m.spark).toEqual([]);
  });

  // @covers FR-01.59
  it("never emits the prototype's demo literals (the fixed count / FR string / 16-value spark)", () => {
    const m = buildProjectLogModel(
      bundle({
        runCount: 3,
        runs: [
          run({ runId: "r1", ts: "2026-07-01T00:00:00Z" }),
          run({ runId: "r2", ts: "2026-07-02T00:00:00Z" }),
          run({ runId: "r3", ts: "2026-07-03T00:00:00Z" }),
        ],
      }),
      70,
    );
    expect(m.runs).toBe(3); // real count, not 209
    expect(m.frCount).toBe(0); // no FRs referenced → 0, not "43/43"
    expect(m.spark).not.toEqual([4, 6, 5, 7, 6, 8, 7, 9, 8, 7, 9, 8, 10, 9, 8, 10]);
  });
});

describe("buildProjectLogModel — graded derivation (AC2)", () => {
  // @covers FR-01.59
  it("derives runs/frCount/score and the last-proof quote from real data", () => {
    const m = buildProjectLogModel(
      bundle({
        runCount: 2,
        runs: [
          run({ runId: "r1", ts: "2026-07-01T00:00:00Z", affectedFrs: ["FR-01.01", "FR-01.02"], summary: "older" }),
          run({ runId: "r2", ts: "2026-07-05T00:00:00Z", newFrs: ["FR-01.02", "FR-01.09"], summary: "latest proof" }),
        ],
        gradeTrend: [
          { ts: "2026-07-01T00:00:00Z", grade: "B", score: 80 },
          { ts: "2026-07-05T00:00:00Z", grade: "A", score: 92 },
        ],
      }),
      92,
    );
    expect(m.graded).toBe(true);
    expect(m.runs).toBe(2);
    expect(m.frCount).toBe(3); // {FR-01.01, FR-01.02, FR-01.09} deduped
    expect(m.score).toBe(92);
    expect(m.spark).toEqual([80, 92]); // grade-trend series, oldest→newest
    expect(m.lastProof).toBe("latest proof"); // most-recent by ts
  });

  // @covers FR-01.59
  it("falls back to a unit bar per run when no trend/test metric is derivable", () => {
    const m = buildProjectLogModel(
      bundle({ runCount: 2, runs: [run({ runId: "a" }), run({ runId: "b" })] }),
      null,
    );
    expect(m.graded).toBe(true);
    expect(m.spark).toEqual([1, 1]);
    expect(m.score).toBeNull();
    expect(m.lastProof).toBe("a"); // summary null → runId fallback
  });
});

describe("statsLine", () => {
  // @covers FR-01.59
  it("omits FRs and score when absent", () => {
    expect(
      statsLine({ graded: true, runs: 1, frCount: 0, score: null, spark: [1], lastProof: null }),
    ).toBe("1 run");
  });

  // @covers FR-01.59
  it("renders the full line with pluralisation", () => {
    expect(
      statsLine({ graded: true, runs: 4, frCount: 2, score: 90, spark: [], lastProof: null }),
    ).toBe("4 runs · 2 FRs · 90/100");
  });
});
