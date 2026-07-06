/*
 * cascade-delete-project-tasks.test.ts —
 * iterate-2026-07-06-project-delete-cascades-tasks.
 *
 * When a project is deleted, every task pointing at it must be removed too;
 * otherwise those tasks keep a dangling projectId and the projects list
 * perpetually synthesizes a phantom, un-clearable "Unassigned" row. This
 * pins the runtime cascade helper.
 */

import { describe, it, expect } from "vitest";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "./sdk-sessions-store.js";
import { cascadeDeleteProjectTasks } from "./cascade-delete-project-tasks.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
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

async function makeStore() {
  const deps = inMemoryDeps();
  const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
  await store.load();
  return { store, deps };
}

describe("cascadeDeleteProjectTasks", () => {
  it("removes exactly the matching tasks, keeps the rest, returns the count", async () => {
    const { store } = await makeStore();
    const a = store.create({ title: "a", cwd: "/c", projectId: "p-doomed" });
    const b = store.create({ title: "b", cwd: "/c", projectId: "p-doomed" });
    const keep = store.create({ title: "c", cwd: "/c", projectId: "p-keep" });
    const unassigned = store.create({ title: "u", cwd: "/c" }); // no projectId

    const scrollback: string[] = [];
    const snapshot: string[] = [];
    const count = await cascadeDeleteProjectTasks("p-doomed", {
      store,
      scrollbackClearBestEffort: async (id) => {
        scrollback.push(id);
      },
      snapshotClearBestEffort: async (id) => {
        snapshot.push(id);
      },
    });

    expect(count).toBe(2);
    expect(store.list().map((t) => t.taskId).sort()).toEqual(
      [keep.taskId, unassigned.taskId].sort(),
    );
    // Both scrollback + snapshot cascade fire once per removed task.
    expect(scrollback.sort()).toEqual([a.taskId, b.taskId].sort());
    expect(snapshot.sort()).toEqual([a.taskId, b.taskId].sort());
  });

  it("returns 0 and performs no cleanup when nothing matches", async () => {
    const { store } = await makeStore();
    store.create({ title: "c", cwd: "/c", projectId: "p-keep" });
    const scrollback: string[] = [];
    const count = await cascadeDeleteProjectTasks("p-none", {
      store,
      scrollbackClearBestEffort: async (id) => {
        scrollback.push(id);
      },
    });
    expect(count).toBe(0);
    expect(scrollback).toEqual([]);
    expect(store.list()).toHaveLength(1);
  });

  it("persists the removal so it survives a reload", async () => {
    const { store, deps } = await makeStore();
    store.create({ title: "a", cwd: "/c", projectId: "p-doomed" });
    const keep = store.create({ title: "c", cwd: "/c", projectId: "p-keep" });
    await cascadeDeleteProjectTasks("p-doomed", { store });

    const reloaded = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await reloaded.load();
    expect(reloaded.list().map((t) => t.taskId)).toEqual([keep.taskId]);
  });

  it("is best-effort: a throwing cleanup callback neither rejects nor aborts the delete", async () => {
    const { store } = await makeStore();
    store.create({ title: "a", cwd: "/c", projectId: "p-doomed" });
    const count = await cascadeDeleteProjectTasks("p-doomed", {
      store,
      scrollbackClearBestEffort: async () => {
        throw new Error("simulated EACCES");
      },
      snapshotClearBestEffort: async () => {
        throw new Error("simulated EACCES");
      },
    });
    expect(count).toBe(1);
    expect(store.list()).toHaveLength(0);
  });
});
