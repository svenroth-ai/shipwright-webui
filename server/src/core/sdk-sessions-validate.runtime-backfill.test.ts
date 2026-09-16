/*
 * sdk-sessions-validate.runtime-backfill.test.ts — Codex Light §3.5's
 * loader backfill, same shape as the v1 `projectId` backfill: a task
 * persisted BEFORE `runtime` existed on disk has no `runtime` field at all.
 * Making `ExternalTask.runtime` non-optional in TypeScript would otherwise
 * mean every pre-existing task fails validation on next load — this proves
 * it doesn't.
 */
import { describe, it, expect } from "vitest";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "./sdk-sessions-store.js";

function inMemoryDeps(initial: Record<string, string>): SdkSessionsStoreDeps {
  const files = new Map<string, string>(Object.entries(initial));
  const existing = new Set<string>(files.keys());
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
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

describe("sdk-sessions-validate — runtime backfill (pre-Codex-Light rows)", () => {
  it("a v4 row with no `runtime` field still loads, backfilled to 'claude'", async () => {
    const path = "/store/sdk-sessions.json";
    const payload = JSON.stringify({
      schemaVersion: 4,
      sessions: {
        "old-task": {
          taskId: "old-task",
          sessionUuid: "11111111-1111-1111-1111-111111111111",
          cwd: "/proj",
          pluginDirs: [],
          title: "Pre-existing task",
          projectId: "proj-1",
          state: "done",
          createdAt: "2026-01-01T00:00:00Z",
          inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
          // no `runtime` field — this is the pre-Codex-Light shape.
        },
      },
    });
    const store = new SdkSessionsStore(path, inMemoryDeps({ [path]: payload }));
    await store.load();
    const task = store.get("old-task");
    expect(task).toBeDefined();
    expect(task?.runtime).toBe("claude");
  });

  it("a row explicitly persisted as codex survives the reload unchanged", async () => {
    const path = "/store/sdk-sessions.json";
    const payload = JSON.stringify({
      schemaVersion: 4,
      sessions: {
        "codex-task": {
          taskId: "codex-task",
          sessionUuid: "22222222-2222-2222-2222-222222222222",
          cwd: "/proj",
          pluginDirs: [],
          title: "Codex task",
          projectId: "proj-1",
          state: "active",
          runtime: "codex",
          createdAt: "2026-01-01T00:00:00Z",
          inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
        },
      },
    });
    const store = new SdkSessionsStore(path, inMemoryDeps({ [path]: payload }));
    await store.load();
    expect(store.get("codex-task")?.runtime).toBe("codex");
  });
});
