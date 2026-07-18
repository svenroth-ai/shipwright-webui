import { describe, it, expect, vi, afterEach } from "vitest";

import {
  getGradeTrend,
  getProjectRun,
  getProjectRuns,
  type RunDataJoin,
  type RunsResponse,
} from "./runDataApi";

const HEX_ADR = "iterate-2026-07-14-abc1234";

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("runDataApi", () => {
  afterEach(() => vi.restoreAllMocks());

  // @covers FR-01.47
  it("getProjectRuns GETs /runs and returns the bundle shape", async () => {
    const run: RunDataJoin = {
      runId: HEX_ADR,
      ts: null,
      source: "iterate",
      intent: "feature",
      changeType: "feature",
      summary: "s",
      description: "d",
      commit: "abc",
      specImpact: "modify",
      specImpactRaw: "Modify",
      affectedFrs: ["FR-01.47"],
      newFrs: [],
      tests: { passed: 10, total: 10 },
      gates: { derived: true, test: "pass", review: "unknown", security: "unknown" },
      phaseDurations: null,
      campaign: null,
      subIterateId: null,
    };
    const payload: RunsResponse = {
      status: "ok",
      runs: [run],
      runCount: 1,
      gradeTrend: [{ ts: "2026-07-14T09:00:00Z", grade: "A", score: 98.2 }],
      pipelinePhaseDurations: [],
      skippedLines: 0,
    };
    const fetchMock = stubFetch(payload);

    const out = await getProjectRuns("p1");
    expect(out.runCount).toBe(1);
    expect(out.runs[0].gates?.derived).toBe(true);
    expect(out.runs[0].phaseDurations).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/external/projects/p1/runs", undefined);
  });

  // @covers FR-01.47
  it("getProjectRun encodes the runId and returns run:null for a miss", async () => {
    const fetchMock = stubFetch({ status: "ok", run: null });
    const out = await getProjectRun("p1", HEX_ADR);
    expect(out.run).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/external/projects/p1/runs/${encodeURIComponent(HEX_ADR)}`,
      undefined,
    );
  });

  // @covers FR-01.47
  it("getGradeTrend GETs /grade-trend and returns the series", async () => {
    const fetchMock = stubFetch({
      status: "ok",
      gradeTrend: [{ ts: "2026-07-14T09:00:00Z", grade: "A", score: 100 }],
    });
    const out = await getGradeTrend("p1");
    expect(out.gradeTrend).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/external/projects/p1/grade-trend",
      undefined,
    );
  });

  // @covers FR-01.47
  it("throws on a non-ok HTTP response (httpJson surfaces the status)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
    );
    await expect(getProjectRuns("p1")).rejects.toThrow(/HTTP 500/);
  });
});
