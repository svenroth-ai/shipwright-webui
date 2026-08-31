/*
 * association.test.ts — the ONE guarded association write, direct unit
 * coverage (iterate-2026-08-31-mission-feed-gaps).
 *
 * No test file existed for association.ts before this run — it was only
 * exercised indirectly through the route tests, which is how the CAS gap
 * below survived (doubt-reviewer HIGH: a lost-update race in
 * `supersedeMissionContext` with no failure involved, so the existing
 * ELOCKED-rollback tests never touched it).
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import {
  revertMissionContext,
  revertSupersession,
  setMissionContextOnce,
  supersedeMissionContext,
} from "./association.js";
import type { ExternalTask } from "../sdk-sessions-store.js";
import type { MissionContextAssociation } from "./types.js";

/** A minimal `Pick<SdkSessionsStore, "get" | "patch">` double — production `get`/`patch` semantics. */
function makeStore(task: ExternalTask) {
  const tasks = new Map<string, ExternalTask>([[task.taskId, task]]);
  return {
    get: (id: string) => tasks.get(id),
    patch: (id: string, patch: Partial<ExternalTask>) => {
      const t = tasks.get(id);
      if (!t) return undefined;
      Object.assign(t, patch);
      return t;
    },
  };
}

function task(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "3c9e3e11-4b53-424e-8062-f9f5a24f6b68",
    projectId: "proj-1",
    ...over,
  } as ExternalTask;
}

function assoc(runId: string, over: Partial<MissionContextAssociation> = {}): MissionContextAssociation {
  return { kind: "iterate", runId, observedAt: "2026-07-01T10:00:00.000Z", source: "transcript_run_id", ...over };
}

describe("setMissionContextOnce", () => {
  it("sets the field on an unassociated task and returns true", () => {
    const t = task();
    const store = makeStore(t);
    expect(setMissionContextOnce(store, "task-1", assoc("iterate-2026-07-01-r1"))).toBe(true);
    expect(t.missionContext?.runId).toBe("iterate-2026-07-01-r1");
  });

  it("no-ops on an already-associated task", () => {
    const t = task({ missionContext: assoc("iterate-2026-07-01-r1") });
    const store = makeStore(t);
    expect(setMissionContextOnce(store, "task-1", assoc("iterate-2026-07-02-r2"))).toBe(false);
    expect(t.missionContext?.runId).toBe("iterate-2026-07-01-r1");
  });
});

describe("revertMissionContext", () => {
  it("clears the field when it still holds the value we set", () => {
    const attempted = assoc("iterate-2026-07-01-r1");
    const t = task({ missionContext: attempted });
    const store = makeStore(t);
    revertMissionContext(store, "task-1", attempted);
    expect(t.missionContext).toBeUndefined();
  });

  it("does not clobber a concurrent writer's value", () => {
    const attempted = assoc("iterate-2026-07-01-r1");
    const concurrent = assoc("iterate-2026-07-02-r2", { observedAt: "2026-07-02T10:00:00.000Z" });
    const t = task({ missionContext: concurrent });
    const store = makeStore(t);
    revertMissionContext(store, "task-1", attempted);
    expect(t.missionContext).toEqual(concurrent);
  });
});

describe("supersedeMissionContext", () => {
  it("writes when the store's current value still matches expectedPrevious", () => {
    const previous = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
    const t = task({ missionContext: previous });
    const store = makeStore(t);
    const next = assoc("iterate-2026-07-20-r2");
    expect(supersedeMissionContext(store, "task-1", next, previous)).toBe(true);
    expect(t.missionContext?.runId).toBe("iterate-2026-07-20-r2");
  });

  it("REJECTS a non-transcript_run_id source, even with a matching previous", () => {
    const previous = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
    const t = task({ missionContext: previous });
    const store = makeStore(t);
    const next = assoc("iterate-2026-07-20-r2", { source: "iterate_active_pointer" });
    expect(supersedeMissionContext(store, "task-1", next, previous)).toBe(false);
    expect(t.missionContext).toEqual(previous);
  });

  it(
    "SKIPS the write when the store's current value no longer matches expectedPrevious " +
      "(doubt-reviewer HIGH: the lost-update race — a faster concurrent poll already " +
      "superseded past what this caller read)",
    () => {
      const stalePrevious = assoc("iterate-2026-07-01-r1");
      // A concurrent poll already wrote a NEWER association since this
      // caller's snapshot was taken.
      const alreadyCurrent = assoc("iterate-2026-08-01-r3", { observedAt: "2026-08-01T10:00:00.000Z" });
      const t = task({ missionContext: alreadyCurrent });
      const store = makeStore(t);
      const staleNext = assoc("iterate-2026-07-20-r2");
      expect(supersedeMissionContext(store, "task-1", staleNext, stalePrevious)).toBe(false);
      // The newer, already-current association survives untouched — NOT
      // regressed to the stale caller's answer.
      expect(t.missionContext).toEqual(alreadyCurrent);
    },
  );

  it("no-ops when the task has no association at all yet", () => {
    const t = task();
    const store = makeStore(t);
    const previous = assoc("iterate-2026-07-01-r1");
    expect(supersedeMissionContext(store, "task-1", assoc("iterate-2026-07-20-r2"), previous)).toBe(false);
    expect(t.missionContext).toBeUndefined();
  });
});

describe("revertSupersession", () => {
  it("restores the PREVIOUS association when the field still holds what we just set", () => {
    const previous = assoc("iterate-2026-07-01-r1");
    const attempted = assoc("iterate-2026-07-20-r2");
    const t = task({ missionContext: attempted });
    const store = makeStore(t);
    revertSupersession(store, "task-1", attempted, previous);
    expect(t.missionContext).toEqual(previous);
  });

  it("does not clobber a concurrent writer's value", () => {
    const previous = assoc("iterate-2026-07-01-r1");
    const attempted = assoc("iterate-2026-07-20-r2");
    const concurrent = assoc("iterate-2026-08-01-r3", { observedAt: "2026-08-01T10:00:00.000Z" });
    const t = task({ missionContext: concurrent });
    const store = makeStore(t);
    revertSupersession(store, "task-1", attempted, previous);
    expect(t.missionContext).toEqual(concurrent);
  });
});
