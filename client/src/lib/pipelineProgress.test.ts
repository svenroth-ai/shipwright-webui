import { describe, it, expect } from "vitest";

import { derivePhaseProgress } from "./pipelineProgress";
import type {
  PhaseTask,
  PhaseTaskStatus,
  RunConfigV2,
  RunPhase,
  RunStatus,
} from "./run-config-v2";

let seq = 0;
function pt(phase: string, status: PhaseTaskStatus, splitId: string | null = null): PhaseTask {
  seq += 1;
  return {
    phaseTaskId: `ptk-${seq.toString(16).padStart(4, "0")}`,
    phase: phase as RunPhase,
    splitId,
    sessionUuid: `uuid-${seq}`,
    version: 1,
    status,
    title: `${phase} task`,
    slashCommand: `/shipwright-${phase}`,
    prerequisites: [],
    executionCount: 0,
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

function config(
  pipeline: RunPhase[],
  phase_tasks: PhaseTask[],
  status: RunStatus = "in_progress",
): RunConfigV2 {
  return {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline,
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status,
    completed_phase_task_ids: [],
    phase_tasks,
    created_at: "2026-07-09T00:00:00.000Z",
  };
}

const SEVEN: RunPhase[] = ["project", "design", "plan", "build", "test", "changelog", "deploy"];

describe("derivePhaseProgress — steady high-water frontier bar", () => {
  it("counts phases strictly BEFORE the active (started) frontier", () => {
    const p = derivePhaseProgress(
      config(SEVEN, [pt("project", "done"), pt("design", "in_progress")]),
    );
    expect(p.totalPhases).toBe(7);
    expect(p.donePhases).toBe(1); // project behind the design frontier
    expect(p.pct).toBe(Math.round((1 / 7) * 100));
  });

  it("the first phase in flight → 0 done, 0% (like a campaign at 0/N)", () => {
    const p = derivePhaseProgress(config(SEVEN, [pt("project", "in_progress")]));
    expect(p.donePhases).toBe(0);
    expect(p.pct).toBe(0);
  });

  it("a pre-seeded BACKLOG future phase does NOT jump the frontier", () => {
    const p = derivePhaseProgress(
      config(SEVEN, [pt("project", "in_progress"), pt("deploy", "backlog")]),
    );
    expect(p.donePhases).toBe(0); // deploy is only backlog → not started
  });

  it("is monotonic across the build fan-out (never recalibrates backward)", () => {
    // A: project+design done, plan/split-0 done, build/split-0 in flight.
    const a = derivePhaseProgress(
      config(SEVEN, [
        pt("project", "done"),
        pt("design", "done"),
        pt("plan", "done", "split-0"),
        pt("build", "in_progress", "split-0"),
      ]),
    );
    expect(a.donePhases).toBe(3); // frontier = build → project/design/plan behind

    // B: fan-out appended — plan/split-1 RE-OPENS (in_progress) + build/split-1
    // backlog. A naive "all-plan-tasks-done" bar would drop plan (→ 2); the
    // frontier holds because `build` was already reached.
    const b = derivePhaseProgress(
      config(SEVEN, [
        pt("project", "done"),
        pt("design", "done"),
        pt("plan", "done", "split-0"),
        pt("build", "done", "split-0"),
        pt("plan", "in_progress", "split-1"),
        pt("build", "backlog", "split-1"),
      ]),
    );
    expect(b.donePhases).toBe(3);
    expect(b.donePhases).toBeGreaterThanOrEqual(a.donePhases);
  });

  it("a complete run pins the bar to full regardless of task bookkeeping", () => {
    const p = derivePhaseProgress(
      config(SEVEN, [pt("project", "done")], "complete"),
    );
    expect(p.donePhases).toBe(7);
    expect(p.pct).toBe(100);
  });

  it("a failed run leaves the bar at the frontier (no phantom fill)", () => {
    const p = derivePhaseProgress(
      config(SEVEN, [pt("project", "done"), pt("design", "failed")], "failed"),
    );
    expect(p.donePhases).toBe(1); // project done; design (failed) is the frontier
  });

  it("phases not in config.pipeline (e.g. conditional security) are ignored", () => {
    const p = derivePhaseProgress(
      config(SEVEN, [
        pt("project", "done"),
        pt("design", "in_progress"),
        pt("security", "in_progress"), // not in the 7-phase pipeline
      ]),
    );
    expect(p.totalPhases).toBe(7);
    expect(p.donePhases).toBe(1);
  });

  it("empty pipeline → 0/0, 0% (no divide-by-zero)", () => {
    const p = derivePhaseProgress(config([], []));
    expect(p).toEqual({ donePhases: 0, totalPhases: 0, pct: 0 });
  });
});
