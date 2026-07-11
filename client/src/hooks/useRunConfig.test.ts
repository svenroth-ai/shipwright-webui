import { describe, it, expect } from "vitest";

import { runConfigPollIntervalMs } from "./useRunConfig";
import type { RunConfigResponse, RunConfigV2, RunStatus } from "../lib/run-config-v2";

/*
 * Poll-cadence unit tests for useRunConfig. Homed here (with the unit under
 * test) rather than in useContinuePipeline.test.ts where they historically
 * lived. Adds the F15 regression: a transient `invalid` (a torn run-config
 * read during the orchestrator's atomic rewrite) must NOT latch polling OFF —
 * the lane would silently vanish mid-run and never reappear without a manual
 * refocus. It keeps polling on a mild backoff so the flap self-heals.
 */

function okResponse(runStatus: RunStatus): RunConfigResponse {
  return {
    status: "ok",
    config: { status: runStatus } as unknown as RunConfigV2,
    readyToLaunchTasks: [],
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

describe("runConfigPollIntervalMs", () => {
  it("polls 5s for in_progress runs", () => {
    expect(runConfigPollIntervalMs(okResponse("in_progress"))).toBe(5_000);
  });

  it("polls 60s for needs_validation runs", () => {
    expect(runConfigPollIntervalMs(okResponse("needs_validation"))).toBe(60_000);
  });

  it("does not poll terminal runs (complete / failed)", () => {
    for (const status of ["complete", "failed"] as const) {
      expect(runConfigPollIntervalMs(okResponse(status))).toBe(false);
    }
  });

  it("does not poll missing / v1_legacy (stable no-pipeline states)", () => {
    expect(runConfigPollIntervalMs({ status: "missing" })).toBe(false);
    expect(runConfigPollIntervalMs({ status: "v1_legacy" })).toBe(false);
  });

  it("keeps polling on a transient invalid so the lane self-heals (F15)", () => {
    // RED on pre-fix main: returned false, latching the poll OFF permanently.
    const interval = runConfigPollIntervalMs({ status: "invalid", reason: "torn" });
    expect(interval).toBeTruthy();
    expect(interval).toBe(10_000);
  });

  it("does not poll undefined data (initial load)", () => {
    expect(runConfigPollIntervalMs(undefined)).toBe(false);
  });
});
