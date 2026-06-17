/*
 * Schema v1 → v2 migration (ADR-038) — write-on-touch contract.
 *
 * The store stays on disk as v1 until the first persist() call after any
 * mutation. Load-time behavior backfills `projectId: "unassigned"` in memory
 * so downstream code sees a uniform shape without tearing the on-disk state.
 *
 * O25 (backward compat): v1 reader tolerates unknown fields (a future v2 row
 *   loaded by an older binary does not throw — the projectId field is soft-
 *   ignored).
 * O26 (deleted project refs): a projectId pointing at a project that no
 *   longer exists in projects.json resolves to "unassigned" on load, and
 *   next persist() writes the canonical value back.
 */

import { describe, it, expect } from "vitest";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "./sdk-sessions-store.js";

function inMemoryDeps(initial?: Record<string, string>): SdkSessionsStoreDeps & {
  __files: Map<string, string>;
} {
  const files = new Map<string, string>();
  if (initial) for (const [p, c] of Object.entries(initial)) files.set(p, c);
  const existing = new Set<string>(files.keys());
  return {
    __files: files,
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

function v1Payload(tasks: Array<Record<string, unknown>>): string {
  const sessions: Record<string, Record<string, unknown>> = {};
  for (const t of tasks) sessions[t.taskId as string] = t;
  return JSON.stringify({ schemaVersion: 1, sessions });
}

function v2Payload(tasks: Array<Record<string, unknown>>): string {
  const sessions: Record<string, Record<string, unknown>> = {};
  for (const t of tasks) sessions[t.taskId as string] = t;
  return JSON.stringify({ schemaVersion: 2, sessions });
}

function baseTask(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    taskId: "t1",
    sessionUuid: "u1",
    cwd: "/tmp",
    pluginDirs: [],
    state: "draft",
    title: "t1-title",
    createdAt: "2026-04-20T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

describe("schema v1 → v2 migration (ADR-038)", () => {
  it("v1-load-injects-unassigned-in-memory: tasks get projectId='unassigned', disk stays v1", async () => {
    const payload = v1Payload([
      baseTask({ taskId: "t1" }),
      baseTask({ taskId: "t2" }),
    ]);
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();

    const tasks = store.list();
    expect(tasks).toHaveLength(2);
    for (const t of tasks) {
      expect(t.projectId).toBe("unassigned");
    }

    // Disk is STILL v1 — no eager rewrite on load.
    const onDisk = JSON.parse(deps.__files.get("/store/sdk-sessions.json")!) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(1);
  });

  it("write-on-touch: persist() after patch rewrites as the current schema version with projectId on every row", async () => {
    const payload = v1Payload([
      baseTask({ taskId: "t1" }),
      baseTask({ taskId: "t2" }),
    ]);
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();

    store.patch("t1", { title: "new-title" });
    await store.persist();

    const onDisk = JSON.parse(deps.__files.get("/store/sdk-sessions.json")!) as {
      schemaVersion: number;
      sessions: Record<string, { projectId: string }>;
    };
    // CURRENT_SCHEMA_VERSION is 4 since iterate-2026-06-17 (boardColumn).
    // Older binaries reading this file fall back via the v1–v4 compat
    // window in validateExternalTask().
    expect(onDisk.schemaVersion).toBe(4);
    // BOTH touched + untouched rows get the canonical projectId on disk —
    // persist writes the whole shape atomically.
    expect(onDisk.sessions.t1.projectId).toBe("unassigned");
    expect(onDisk.sessions.t2.projectId).toBe("unassigned");
  });

  it("v1-reader-tolerates-v2-extra-field (O25): loader does not throw on unknown projectId field in a v1-tagged file", async () => {
    // Craft a file that advertises schemaVersion: 1 but carries a projectId on
    // a row. This simulates an older binary reading a v2-ish row after a
    // partial rollback. Validator should not throw; the extra field is
    // ignored (the v1 branch backfills unassigned).
    const payload = JSON.stringify({
      schemaVersion: 1,
      sessions: {
        t1: baseTask({ taskId: "t1", projectId: "p-future" }),
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();

    const list = store.list();
    expect(list).toHaveLength(1);
    // In v1-branch load, we don't trust the field — unassigned backfill wins.
    expect(list[0].projectId).toBe("unassigned");
  });

  it("deleted-project-resolves-to-unassigned (O26): projectId pointing at unknown project resolves to unassigned in memory + on next persist", async () => {
    const payload = v2Payload([
      baseTask({ taskId: "t1", projectId: "deleted-project-id" }),
      baseTask({ taskId: "t2", projectId: "live-project-id" }),
    ]);
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", {
      ...deps,
      getKnownProjectIds: () => new Set(["live-project-id"]),
    } as SdkSessionsStoreDeps);
    await store.load();

    const t1 = store.get("t1");
    const t2 = store.get("t2");
    expect(t1?.projectId).toBe("unassigned");
    expect(t2?.projectId).toBe("live-project-id");

    // Next persist writes the canonical resolved value back.
    store.patch("t1", { title: "touch" });
    await store.persist();

    const onDisk = JSON.parse(deps.__files.get("/store/sdk-sessions.json")!) as {
      sessions: Record<string, { projectId: string }>;
    };
    expect(onDisk.sessions.t1.projectId).toBe("unassigned");
    expect(onDisk.sessions.t2.projectId).toBe("live-project-id");
  });

  it("v2-load-preserves-valid-projectId when getKnownProjectIds not provided", async () => {
    // Unit-test fallback path: loader should pass through projectId when the
    // dep is absent (legacy unit tests without the wiring).
    const payload = v2Payload([
      baseTask({ taskId: "t1", projectId: "some-project" }),
    ]);
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    expect(store.get("t1")?.projectId).toBe("some-project");
  });

  it("v2-load-rejects-null-or-empty-projectId as soft-skip", async () => {
    // Null / empty-string projectId in a v2-tagged file is corrupt. The row
    // should be soft-skipped (not wipe the whole file).
    const payload = JSON.stringify({
      schemaVersion: 2,
      sessions: {
        good: baseTask({ taskId: "good", projectId: "ok" }),
        bad1: baseTask({ taskId: "bad1", projectId: "" }),
        bad2: baseTask({ taskId: "bad2", projectId: null }),
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].taskId).toBe("good");
  });
});

describe("schema v3 phase-task linkage (iterate/multi-session-run-orchestrator-v2)", () => {
  it("v3-load: phaseTaskId / runId / parentRunMaster round-trip from disk", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        t1: baseTask({
          taskId: "t1",
          projectId: "p1",
          phaseTaskId: "ptk-aaaa",
          runId: "run-12345678",
          parentRunMaster: false,
        }),
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const t1 = store.get("t1");
    expect(t1?.phaseTaskId).toBe("ptk-aaaa");
    expect(t1?.runId).toBe("run-12345678");
    expect(t1?.parentRunMaster).toBe(false);
  });

  it("v3-load: tolerates missing v3 fields (forward-compat — pre-v3 rows tagged v3)", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        t1: baseTask({ taskId: "t1", projectId: "p1" }),
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const t1 = store.get("t1");
    expect(t1?.phaseTaskId).toBeUndefined();
    expect(t1?.runId).toBeUndefined();
    expect(t1?.parentRunMaster).toBeUndefined();
  });

  it("v3-load: soft-ignores wrong-typed v3 fields (e.g. number runId)", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      sessions: {
        t1: baseTask({
          taskId: "t1",
          projectId: "p1",
          phaseTaskId: 12345,
          runId: null,
          parentRunMaster: "not-a-boolean",
        }),
      },
    });
    const deps = inMemoryDeps({ "/store/sdk-sessions.json": payload });
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const t1 = store.get("t1");
    expect(t1).toBeDefined();
    expect(t1?.phaseTaskId).toBeUndefined();
    expect(t1?.runId).toBeUndefined();
    expect(t1?.parentRunMaster).toBeUndefined();
  });

  it("create() accepts sessionUuid override + phase-task fields", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const task = store.create({
      title: "Run-12345678 / build / 01-core",
      cwd: "/proj",
      projectId: "p1",
      sessionUuid: "33333333-4444-4555-8666-777777777777",
      phaseTaskId: "ptk-cccc",
      runId: "run-12345678",
      parentRunMaster: false,
    });
    expect(task.sessionUuid).toBe("33333333-4444-4555-8666-777777777777");
    expect(task.phaseTaskId).toBe("ptk-cccc");
    expect(task.runId).toBe("run-12345678");
    expect(task.parentRunMaster).toBe(false);
  });

  it("findByPhaseTaskId returns the existing non-terminal shadow", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const task = store.create({
      title: "shadow",
      cwd: "/proj",
      projectId: "p1",
      phaseTaskId: "ptk-cccc",
      runId: "run-12345678",
      parentRunMaster: false,
    });
    const found = store.findByPhaseTaskId("ptk-cccc");
    expect(found?.taskId).toBe(task.taskId);
  });

  it("findByPhaseTaskId skips done shadows so a closed task can be re-launched", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const old = store.create({
      title: "old",
      cwd: "/proj",
      projectId: "p1",
      phaseTaskId: "ptk-cccc",
      runId: "run-12345678",
      parentRunMaster: false,
    });
    store.patch(old.taskId, { state: "done" });
    expect(store.findByPhaseTaskId("ptk-cccc")).toBeUndefined();
  });

  it("persist after creating a v3 task writes the new fields to disk", async () => {
    const deps = inMemoryDeps();
    const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    store.create({
      title: "shadow",
      cwd: "/proj",
      projectId: "p1",
      phaseTaskId: "ptk-cccc",
      runId: "run-12345678",
      parentRunMaster: false,
    });
    await store.persist();
    const onDisk = JSON.parse(deps.__files.get("/store/sdk-sessions.json")!) as {
      schemaVersion: number;
      sessions: Record<
        string,
        { phaseTaskId?: string; runId?: string; parentRunMaster?: boolean }
      >;
    };
    expect(onDisk.schemaVersion).toBe(4);
    const row = Object.values(onDisk.sessions)[0];
    expect(row.phaseTaskId).toBe("ptk-cccc");
    expect(row.runId).toBe("run-12345678");
    expect(row.parentRunMaster).toBe(false);
  });
});
