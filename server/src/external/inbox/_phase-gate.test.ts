/*
 * external/inbox/_phase-gate.test.ts — the `phase_gate` inbox kind
 * (iterate-2026-10-29-inbox-guided-phase-questions). Real loop-state files in
 * a temp project dir; the store is a minimal `list()` stub.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import { appendPhaseGates, PHASE_GATE_PROMPT_TEXT } from "./_phase-gate.js";
import type { AggregatedEntry } from "./_types.js";

let proj: string;

beforeEach(() => {
  proj = mkdtempSync(path.join(tmpdir(), "phase-gate-"));
  mkdirSync(path.join(proj, ".shipwright"), { recursive: true });
});
afterEach(() => rmSync(proj, { recursive: true, force: true }));

function writeLoop(state: Record<string, unknown>): void {
  writeFileSync(
    path.join(proj, ".shipwright", "run_loop_state.json"),
    JSON.stringify(state),
  );
}

function storeOf(...tasks: Array<Record<string, unknown>>): SdkSessionsStore {
  return { list: () => tasks } as unknown as SdkSessionsStore;
}

const task = (over: Record<string, unknown> = {}) => ({
  taskId: "t1",
  sessionUuid: "u1",
  title: "Plan phase",
  cwd: proj,
  state: "running",
  phaseTaskId: "ptk-1",
  ...over,
});

describe("appendPhaseGates", () => {
  // @covers FR-01.04
  it("surfaces the task whose phase task is paused at a human gate", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, { store: storeOf(task()) });
    expect(out).toEqual([
      {
        kind: "phase_gate",
        taskId: "t1",
        sessionUuid: "u1",
        taskTitle: "Plan phase",
        promptText: PHASE_GATE_PROMPT_TEXT,
        bestEffort: true,
      },
    ]);
  });

  // @covers FR-01.04
  it("emits nothing once the loop resumed (status running)", async () => {
    writeLoop({ status: "running", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, { store: storeOf(task()) });
    expect(out).toEqual([]);
  });

  // @covers FR-01.04
  it("ignores a task bound to a different phase task", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-2" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, { store: storeOf(task()) });
    expect(out).toEqual([]);
  });

  // @covers FR-01.04
  it("emits nothing for a missing or torn loop-state file", async () => {
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, { store: storeOf(task()) });
    writeFileSync(path.join(proj, ".shipwright", "run_loop_state.json"), "{ torn");
    await appendPhaseGates(out, { store: storeOf(task()) });
    expect(out).toEqual([]);
  });

  // @covers FR-01.04
  it("skips done tasks and tasks without a phaseTaskId", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, {
      store: storeOf(task({ state: "done" }), task({ taskId: "t2", phaseTaskId: undefined })),
    });
    expect(out).toEqual([]);
  });

  // @covers FR-01.04
  it("defers to a specific question already surfaced for the same task", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [
      {
        kind: "terminal_prompt",
        taskId: "t1",
        sessionUuid: "u1",
        taskTitle: "Plan phase",
        promptText: "Which option?",
        bestEffort: true,
      },
    ];
    await appendPhaseGates(out, { store: storeOf(task()) });
    expect(out.map((e) => e.kind)).toEqual(["terminal_prompt"]);
  });

  // @covers FR-01.04
  it("skips a phase task already terminal in the run-config (stale gate)", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, {
      store: storeOf(task()),
      readRunConfig: async () =>
        ({
          status: "ok",
          config: { phase_tasks: [{ phaseTaskId: "ptk-1", status: "done" }] },
        }) as never,
    });
    expect(out).toEqual([]);
  });

  // @covers FR-01.04
  it("still surfaces when the run-config is unreadable", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, {
      store: storeOf(task()),
      readRunConfig: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toHaveLength(1);
  });

  // @covers FR-01.04
  it("emits one entry when two live tasks share a phase task", async () => {
    writeLoop({ status: "paused_human_gate", currentPhaseTaskId: "ptk-1" });
    const out: AggregatedEntry[] = [];
    await appendPhaseGates(out, {
      store: storeOf(task(), task({ taskId: "t2", sessionUuid: "u2" })),
    });
    expect(out).toHaveLength(1);
  });
});
