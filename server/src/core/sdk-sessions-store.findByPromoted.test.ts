import { describe, it, expect, beforeEach } from "vitest";
import { SdkSessionsStore, type SdkSessionsStoreDeps } from "./sdk-sessions-store.js";

function inMemoryDeps(): SdkSessionsStoreDeps & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    _files: files,
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

describe("SdkSessionsStore: findByPromotedFromTriageId + create() promotedFromTriageId arg", () => {
  let store: SdkSessionsStore;

  beforeEach(async () => {
    const deps = inMemoryDeps();
    store = new SdkSessionsStore("/tmp/test/sdk-sessions.json", deps);
    await store.load();
  });

  it("create() accepts promotedFromTriageId and persists it on the in-memory record", () => {
    const task = store.create({
      title: "Promoted from triage",
      cwd: "/tmp/proj",
      projectId: "proj-1",
      promotedFromTriageId: "trg-aaaa1111",
    });
    expect(task.promotedFromTriageId).toBe("trg-aaaa1111");
  });

  it("findByPromotedFromTriageId returns the task with the matching back-ref", () => {
    const task = store.create({
      title: "Triage promoted",
      cwd: "/tmp/proj",
      projectId: "proj-1",
      promotedFromTriageId: "trg-bbbb2222",
    });
    const found = store.findByPromotedFromTriageId("trg-bbbb2222");
    expect(found?.taskId).toBe(task.taskId);
  });

  it("findByPromotedFromTriageId returns undefined when no match", () => {
    store.create({
      title: "Other task",
      cwd: "/tmp/proj",
      projectId: "proj-1",
    });
    expect(store.findByPromotedFromTriageId("trg-no-match")).toBeUndefined();
  });

  it("findByPromotedFromTriageId returns done-state tasks too (idempotent recovery)", () => {
    const task = store.create({
      title: "Old promoted task",
      cwd: "/tmp/proj",
      projectId: "proj-1",
      promotedFromTriageId: "trg-cccc3333",
    });
    // Simulate the task reaching done state
    store.patch(task.taskId, { state: "done" });
    const found = store.findByPromotedFromTriageId("trg-cccc3333");
    expect(found?.taskId).toBe(task.taskId);
    expect(found?.state).toBe("done");
  });

  it("create() ignores promotedFromTriageId when not a string", () => {
    const task = store.create({
      title: "X",
      cwd: "/tmp/proj",
      projectId: "proj-1",
      promotedFromTriageId: 42 as unknown as string,
    });
    expect(task.promotedFromTriageId).toBeUndefined();
  });

  it("schema round-trip: persist + reload preserves promotedFromTriageId", async () => {
    const deps = inMemoryDeps();
    const writePath = "/tmp/test/sdk-sessions.json";
    const s1 = new SdkSessionsStore(writePath, deps);
    await s1.load();
    const task = s1.create({
      title: "Round-trip task",
      cwd: "/tmp/proj",
      projectId: "proj-1",
      promotedFromTriageId: "trg-roundtrip",
    });
    await s1.persist();

    const s2 = new SdkSessionsStore(writePath, deps);
    await s2.load();
    const reloaded = s2.get(task.taskId);
    expect(reloaded?.promotedFromTriageId).toBe("trg-roundtrip");
  });
});
