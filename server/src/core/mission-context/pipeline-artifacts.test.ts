/*
 * pipeline-artifacts.test.ts — S3 AC1 (pipeline half).
 *
 * The two properties that matter:
 *   1. NO CONFLATION. A run holds many phase tasks and, with splits, several for
 *      the same phase. Resolution must key on `phaseTaskId` alone. The tests
 *      below build a run where phase-name matching and session matching would
 *      each pick the WRONG task, so a regression to either is a failure here
 *      rather than a silent misattribution in production.
 *   2. "cannot read" and "not in the config" are DIFFERENT, and neither is
 *      "nothing here".
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildPipelineFact } from "../../external/mission-context/facts-slice3.js";
import {
  buildPhaseArtifact,
  buildPipelineSpecArtifact,
  type PipelineFact,
} from "./pipeline-artifacts.js";
import type { RunConfigReadResult } from "../run-config-reader.js";
import type { PhaseTask, RunConfigV2 } from "../../types/run-config-v2.js";

function phaseTask(over: Partial<PhaseTask>): PhaseTask {
  return {
    phaseTaskId: "ptk-0001",
    phase: "build",
    splitId: null,
    sessionUuid: "11111111-2222-4333-8444-555555555555",
    version: 1,
    status: "done",
    title: "Run-a1b2 / build",
    slashCommand: "/shipwright-build",
    prerequisites: [],
    executionCount: 1,
    createdAt: "2026-04-25T08:00:00.000Z",
    errors: [],
    ...over,
  } as PhaseTask;
}

/**
 * A run with THREE build tasks: two splits plus a re-run, all sharing a phase
 * and two of them sharing a session uuid. Any resolution strategy other than an
 * exact id match picks the wrong one.
 */
const SHARED_SESSION = "99999999-8888-4777-8666-555555555555";
const AMBIGUOUS_TASKS: PhaseTask[] = [
  phaseTask({ phaseTaskId: "ptk-aaaa", phase: "build", splitId: "01-core", status: "done", sessionUuid: SHARED_SESSION }),
  phaseTask({
    phaseTaskId: "ptk-bbbb",
    phase: "build",
    splitId: "02-ui",
    status: "in_progress",
    sessionUuid: SHARED_SESSION,
    description: "Build the UI split",
    startedAt: "2026-04-25T10:00:00.000Z",
    result: { ok: false, artifacts: ["planning/02-ui/plan.md"] },
  }),
  phaseTask({ phaseTaskId: "ptk-cccc", phase: "build", splitId: "03-api", status: "failed", errors: ["boom"] }),
];

function config(tasks: PhaseTask[]): RunConfigReadResult {
  return {
    status: "ok",
    config: { runId: "run-a1b2c3d4", phase_tasks: tasks } as unknown as RunConfigV2,
    diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
  };
}

describe("buildPipelineFact — exact-id resolution, never conflation", () => {
  it("resolves the ONE task whose id matches, among siblings sharing phase and session", () => {
    const fact = buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-bbbb");
    expect(fact.status).toBe("ok");
    if (fact.status !== "ok") return;
    expect(fact.task.phaseTaskId).toBe("ptk-bbbb");
    expect(fact.task.splitId).toBe("02-ui");
    expect(fact.task.status).toBe("in_progress");
    // The neighbours' facts must not bleed in.
    expect(fact.task.errors).toEqual([]);
  });

  it("resolves the FAILED sibling correctly when asked for it by id", () => {
    const fact = buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-cccc");
    if (fact.status !== "ok") throw new Error("expected ok");
    expect(fact.task.splitId).toBe("03-api");
    expect(fact.task.errors).toEqual(["boom"]);
  });

  it("carries the PIPELINE runId, never an iterate run_id", () => {
    const fact = buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-aaaa");
    if (fact.status !== "ok") throw new Error("expected ok");
    expect(fact.runId).toBe("run-a1b2c3d4");
  });

  it("reports task_not_found when the config READ FINE and lacks the task", () => {
    const fact = buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-zzzz");
    expect(fact.status).toBe("task_not_found");
  });

  it.each([
    ["missing", { status: "missing" } as RunConfigReadResult],
    ["v1_legacy", { status: "v1_legacy" } as RunConfigReadResult],
    ["invalid", { status: "invalid", reason: "torn" } as RunConfigReadResult],
  ])("reports `unavailable` (not empty) when the run-config is %s", (_n, rc) => {
    expect(buildPipelineFact(rc, "ptk-aaaa").status).toBe("unavailable");
  });

  it("is unavailable when the task carries no phase-task id at all", () => {
    expect(buildPipelineFact(config(AMBIGUOUS_TASKS), null).status).toBe("unavailable");
  });

  it("keeps `result.artifacts` as strings and tolerates non-string entries", () => {
    const t = phaseTask({
      phaseTaskId: "ptk-dddd",
      result: { ok: true, artifacts: ["planning/requirements.md", 7 as unknown as string] },
    });
    const fact = buildPipelineFact(config([t]), "ptk-dddd");
    if (fact.status !== "ok") throw new Error("expected ok");
    expect(fact.task.outputs).toEqual(["planning/requirements.md"]);
  });

  it("normalises an unrecorded executionCount to null rather than 0", () => {
    const t = phaseTask({ phaseTaskId: "ptk-eeee", executionCount: undefined as unknown as number });
    const fact = buildPipelineFact(config([t]), "ptk-eeee");
    if (fact.status !== "ok") throw new Error("expected ok");
    expect(fact.task.executionCount).toBeNull();
  });
});

describe("buildPhaseArtifact", () => {
  const okFact = buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-bbbb");

  it("renders plain language, not raw enums", () => {
    const a = buildPhaseArtifact(okFact);
    expect(a.state).toBe("available");
    expect(a.summary).toContain("Build");
    expect(a.summary).toContain("running now");
    expect(a.summary).not.toContain("in_progress");
    expect(a.receipt).toBe("Build · 02-ui");
  });

  it("names the error count for a failed phase", () => {
    const a = buildPhaseArtifact(buildPipelineFact(config(AMBIGUOUS_TASKS), "ptk-cccc"));
    expect(a.summary).toContain("failed");
    expect(a.summary).toContain("an error");
  });

  it("an UNREADABLE run-config shows as unavailable, with the reason stated", () => {
    const a = buildPhaseArtifact({ status: "unavailable" });
    expect(a.state).toBe("unavailable");
    expect(a.note).toContain("could not be read");
    expect(a.detail).toBeNull();
  });

  it("a MISSING phase task shows as unavailable with a DIFFERENT reason", () => {
    const notFound: PipelineFact = { status: "task_not_found", runId: "run-a1b2c3d4" };
    const a = buildPhaseArtifact(notFound);
    expect(a.state).toBe("unavailable");
    // Distinguishable from the unreadable case — that separation is the point.
    expect(a.note).toContain("no longer lists");
    expect(a.note).not.toBe(buildPhaseArtifact({ status: "unavailable" }).note);
  });

  it("NEITHER failure hides the artifact", () => {
    for (const f of [{ status: "unavailable" } as PipelineFact, { status: "task_not_found", runId: "r" } as PipelineFact]) {
      expect(["not_applicable", "not_yet_created"]).not.toContain(buildPhaseArtifact(f).state);
    }
  });
});

describe("buildPipelineSpecArtifact", () => {
  it("links the adopted spec and says it holds the requirements", () => {
    const a = buildPipelineSpecArtifact({ documentId: "doc", title: "spec.md", denied: false });
    expect(a.state).toBe("available");
    expect(a.label).toBe("Spec & requirements");
    expect(a.summary).toContain("requirements");
    expect(a.detail?.documentId).toBe("doc");
  });

  it("a project with no adopted spec hides it — a real absence", () => {
    const a = buildPipelineSpecArtifact({ documentId: null, title: null, denied: false });
    expect(a.state).toBe("not_yet_created");
  });

  it("a GUARD REFUSAL is an integrity signal and stays visible", () => {
    const a = buildPipelineSpecArtifact({ documentId: null, title: null, denied: true });
    expect(a.state).toBe("unavailable");
    expect(a.note).toBeTruthy();
  });
});
