/*
 * run-loop-state-reader.test.ts — the design-gate predicate (AC1) + torn/absent
 * loop-state safety.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readLoopState,
  deriveDesignGate,
  loopStatePath,
  INACTIVE_DESIGN_GATE,
  PAUSED_HUMAN_GATE,
} from "./run-loop-state-reader.js";
import type { RunConfigV2, PhaseTask } from "../types/run-config-v2.js";

function phaseTask(over: Partial<PhaseTask>): PhaseTask {
  return {
    phaseTaskId: "ptk-aaaa",
    phase: "design",
    splitId: null,
    sessionUuid: "00000000-0000-4000-8000-000000000000",
    version: 1,
    status: "in_progress",
    title: "Design",
    slashCommand: "/shipwright-design",
    prerequisites: [],
    executionCount: 0,
    createdAt: "2026-07-10T00:00:00Z",
    ...over,
  };
}

function config(phase_tasks: PhaseTask[]): RunConfigV2 {
  return {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    mode: "single_session",
    deploy_target: "none",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: {} as RunConfigV2["runConditions"],
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: [],
    phase_tasks,
    created_at: "2026-07-10T00:00:00Z",
  };
}

describe("deriveDesignGate (AC1 — paused-at-design + viewer present)", () => {
  const cfg = config([
    phaseTask({ phaseTaskId: "ptk-design", phase: "design" }),
    phaseTask({ phaseTaskId: "ptk-plan", phase: "plan", slashCommand: "/shipwright-plan" }),
  ]);

  it("active when paused_human_gate at the design phase task AND the viewer exists", () => {
    const gate = deriveDesignGate(
      { status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-design" },
      cfg,
      true,
    );
    expect(gate).toEqual({ active: true, phaseTaskId: "ptk-design", phase: "design" });
  });

  it("INACTIVE when the viewer has not been emitted yet", () => {
    const gate = deriveDesignGate(
      { status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-design" },
      cfg,
      false,
    );
    expect(gate.active).toBe(false);
  });

  it("INACTIVE when paused at a NON-design phase (e.g. plan)", () => {
    expect(
      deriveDesignGate(
        { status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-plan" },
        cfg,
        true,
      ),
    ).toEqual(INACTIVE_DESIGN_GATE);
  });

  it("INACTIVE when the loop is running (gate cleared / not paused)", () => {
    expect(
      deriveDesignGate({ status: "running", currentPhaseTaskId: "ptk-design" }, cfg, true),
    ).toEqual(INACTIVE_DESIGN_GATE);
  });

  it("INACTIVE when there is no loop-state at all", () => {
    expect(deriveDesignGate(null, cfg, true)).toEqual(INACTIVE_DESIGN_GATE);
  });

  it("INACTIVE when currentPhaseTaskId does not resolve in the config", () => {
    expect(
      deriveDesignGate(
        { status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-ghost" },
        cfg,
        true,
      ),
    ).toEqual(INACTIVE_DESIGN_GATE);
  });

  it("INACTIVE when the config is unavailable", () => {
    expect(
      deriveDesignGate({ status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-design" }, null, true),
    ).toEqual(INACTIVE_DESIGN_GATE);
  });

  it("INACTIVE when the design phase task is already terminal (R8 anti-staleness)", () => {
    const doneCfg = config([
      phaseTask({ phaseTaskId: "ptk-design", phase: "design", status: "done" }),
    ]);
    expect(
      deriveDesignGate(
        { status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-design" },
        doneCfg,
        true,
      ),
    ).toEqual(INACTIVE_DESIGN_GATE);
  });
});

describe("readLoopState (torn / absent safety)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "loopstate-"));
    mkdirSync(path.join(dir, ".shipwright"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns null when the file is absent", () => {
    expect(readLoopState(dir)).toBeNull();
  });

  it("returns null on malformed JSON (torn write)", () => {
    writeFileSync(loopStatePath(dir), '{"status": "paused_hum', "utf-8");
    expect(readLoopState(dir)).toBeNull();
  });

  it("parses a well-formed loop-state", () => {
    writeFileSync(
      loopStatePath(dir),
      JSON.stringify({ status: PAUSED_HUMAN_GATE, currentPhaseTaskId: "ptk-design", runId: "run-a1b2c3d4" }),
      "utf-8",
    );
    expect(readLoopState(dir)).toMatchObject({
      status: PAUSED_HUMAN_GATE,
      currentPhaseTaskId: "ptk-design",
    });
  });
});
