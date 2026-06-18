/*
 * iterate-2026-06-17-board-dnd-status-decouple — schema v4 `boardColumn`.
 *
 * `boardColumn` is a sticky, user-owned board-column override
 * ("backlog" | "in_progress" | "done"). It is additive + write-on-touch:
 * never synthesized on load, only persisted when explicitly set. The loader
 * accepts v1–v4; persist writes v4. A separate file (not the grandfathered
 * sdk-sessions-store.test.ts) per the bloat-ceiling constraint.
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

function baseTask(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    taskId: "t1",
    sessionUuid: "u1",
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p1",
    state: "draft",
    title: "t1-title",
    createdAt: "2026-06-17T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function payload(version: number, tasks: Array<Record<string, unknown>>): string {
  const sessions: Record<string, Record<string, unknown>> = {};
  for (const t of tasks) sessions[t.taskId as string] = t;
  return JSON.stringify({ schemaVersion: version, sessions });
}

const PATH = "/store/sdk-sessions.json";

describe("sdk-sessions-store — schema v4 boardColumn", () => {
  it("create() does NOT set boardColumn (write-on-touch: absent until set)", () => {
    const store = new SdkSessionsStore(PATH, inMemoryDeps());
    const t = store.create({ title: "x", cwd: "/tmp", projectId: "p1" });
    expect(t.boardColumn).toBeUndefined();
  });

  it("persist writes schemaVersion 4 after a mutation (write-on-touch upgrade from v3)", async () => {
    const deps = inMemoryDeps({ [PATH]: payload(3, [baseTask({ taskId: "t1" })]) });
    const store = new SdkSessionsStore(PATH, deps);
    await store.load();
    store.patch("t1", { boardColumn: "in_progress" });
    await store.persist();
    const onDisk = JSON.parse(deps.__files.get(PATH)!) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(4);
  });

  it("a valid boardColumn round-trips through persist + reload", async () => {
    const deps = inMemoryDeps({ [PATH]: payload(4, [baseTask({ taskId: "t1" })]) });
    const store = new SdkSessionsStore(PATH, deps);
    await store.load();
    store.patch("t1", { boardColumn: "done" });
    await store.persist();

    const reloaded = new SdkSessionsStore(PATH, inMemoryDeps({ [PATH]: deps.__files.get(PATH)! }));
    await reloaded.load();
    expect(reloaded.get("t1")!.boardColumn).toBe("done");
  });

  it("an invalid boardColumn on disk loads as absent (soft-drop)", async () => {
    const deps = inMemoryDeps({
      [PATH]: payload(4, [baseTask({ taskId: "t1", boardColumn: "garbage" })]),
    });
    const store = new SdkSessionsStore(PATH, deps);
    await store.load();
    expect(store.get("t1")!.boardColumn).toBeUndefined();
    // the rest of the row survives
    expect(store.get("t1")!.title).toBe("t1-title");
  });

  it("all three valid columns are accepted", async () => {
    for (const col of ["backlog", "in_progress", "done"] as const) {
      const deps = inMemoryDeps({
        [PATH]: payload(4, [baseTask({ taskId: "t1", boardColumn: col })]),
      });
      const store = new SdkSessionsStore(PATH, deps);
      await store.load();
      expect(store.get("t1")!.boardColumn).toBe(col);
    }
  });

  it("forward-compat: a boardColumn on a v3-tagged row is tolerated (like other additive fields)", async () => {
    const deps = inMemoryDeps({
      [PATH]: payload(3, [baseTask({ taskId: "t1", boardColumn: "in_progress" })]),
    });
    const store = new SdkSessionsStore(PATH, deps);
    await store.load();
    expect(store.get("t1")!.boardColumn).toBe("in_progress");
  });

  it("back-compat: v1/v2/v3/v4 files all still load", async () => {
    for (const v of [1, 2, 3, 4]) {
      const deps = inMemoryDeps({ [PATH]: payload(v, [baseTask({ taskId: "t1" })]) });
      const store = new SdkSessionsStore(PATH, deps);
      await store.load();
      expect(store.list()).toHaveLength(1);
    }
  });
});
