/*
 * association-write.test.ts — `persistMissionAssociation`, direct unit
 * coverage (iterate-2026-08-31-mission-feed-gaps).
 *
 * No test file existed for this module before this run (doubt-reviewer HIGH:
 * a glob for association test files returned nothing, and `routes.test.ts`'s
 * only ELOCKED test exercises the first-association path, never
 * supersession). This pins the race that finding described: `routes.ts`
 * snapshots `associationAtResolve` BEFORE `resolveMissionContext`'s slow
 * async work; a concurrent poll can write a newer association in that
 * window, and the write here must compare against the SNAPSHOT, not a fresh
 * re-read, or it silently regresses the store.
 *
 * @covers FR-01.66
 */

import { describe, expect, it, vi } from "vitest";

import { persistMissionAssociation } from "./association-write.js";
import type { ExternalTask, SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { MissionContextAssociation } from "../../core/mission-context/types.js";

function makeStore(task: ExternalTask, opts: { persistThrows?: boolean } = {}) {
  const tasks = new Map<string, ExternalTask>([[task.taskId, task]]);
  const persist = vi.fn(async () => {
    if (opts.persistThrows) throw new Error("ELOCKED");
  });
  const store = {
    get: (id: string) => tasks.get(id),
    patch: (id: string, patch: Partial<ExternalTask>) => {
      const t = tasks.get(id);
      if (!t) return undefined;
      Object.assign(t, patch);
      return t;
    },
    persist,
  } satisfies Pick<SdkSessionsStore, "get" | "patch" | "persist">;
  return { store: store as unknown as SdkSessionsStore, persist };
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

const now = () => new Date("2026-08-31T09:00:00.000Z");

describe("persistMissionAssociation — first association", () => {
  it("writes and persists when the task had none", async () => {
    const t = task();
    const { store, persist } = makeStore(t);
    await persistMissionAssociation(store, t, null, "iterate-2026-07-01-r1", "transcript_run_id", now, new Map());
    expect(t.missionContext?.runId).toBe("iterate-2026-07-01-r1");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("rolls back the in-memory field AND the wide-window entry on a persist failure", async () => {
    const t = task();
    const { store } = makeStore(t, { persistThrows: true });
    const wideWindows = new Map([["task-1", { seen: "rev-1", scanned: "" }]]);
    await persistMissionAssociation(store, t, null, "iterate-2026-07-01-r1", "transcript_run_id", now, wideWindows);
    expect(t.missionContext).toBeUndefined();
    expect(wideWindows.has("task-1")).toBe(false);
  });
});

describe("persistMissionAssociation — supersession", () => {
  it("writes when the store's current value still matches the resolve-time snapshot", async () => {
    const snapshot = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
    const t = task({ missionContext: snapshot });
    const { store, persist } = makeStore(t);
    await persistMissionAssociation(store, t, snapshot, "iterate-2026-07-20-r2", "transcript_run_id", now, new Map());
    expect(t.missionContext?.runId).toBe("iterate-2026-07-20-r2");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it(
    "does NOT regress the store when a concurrent poll already superseded past the snapshot " +
      "(the lost-update race, doubt-reviewer HIGH)",
    async () => {
      const staleSnapshot = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
      // Simulates a faster concurrent poll (multi-tab, or the next ~1s tick)
      // that resolved against the SAME stale snapshot but wrote first, with a
      // genuinely newer recovered run.
      const alreadyCurrent = assoc("iterate-2026-08-01-r3", { observedAt: "2026-08-01T10:00:00.000Z" });
      const t = task({ missionContext: alreadyCurrent });
      const { store, persist } = makeStore(t);

      // This call's decision was made against `staleSnapshot`, before the
      // concurrent write landed.
      await persistMissionAssociation(
        store,
        t,
        staleSnapshot,
        "iterate-2026-07-20-r2",
        "transcript_run_id",
        now,
        new Map(),
      );

      // The already-current, newer association must survive untouched — not
      // get overwritten by this poll's now-stale R2 answer.
      expect(t.missionContext).toEqual(alreadyCurrent);
      expect(persist).not.toHaveBeenCalled();
    },
  );

  it("restores the PREVIOUS association (not the empty field) on a persist failure", async () => {
    const previous = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
    const t = task({ missionContext: previous });
    const { store } = makeStore(t, { persistThrows: true });
    await persistMissionAssociation(store, t, previous, "iterate-2026-07-20-r2", "transcript_run_id", now, new Map());
    expect(t.missionContext).toEqual(previous);
  });

  it("does nothing when associateRunId already equals the snapshot's runId", async () => {
    const snapshot = assoc("iterate-2026-07-01-r1", { source: "iterate_active_pointer" });
    const t = task({ missionContext: snapshot });
    const { store, persist } = makeStore(t);
    await persistMissionAssociation(store, t, snapshot, "iterate-2026-07-01-r1", "transcript_run_id", now, new Map());
    expect(t.missionContext).toEqual(snapshot);
    expect(persist).not.toHaveBeenCalled();
  });
});
