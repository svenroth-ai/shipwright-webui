/*
 * external/inbox/__tests__/routes.test.ts — per-router contract for
 * GET /api/external/inbox + POST /inbox/:toolUseId/dismiss.
 *
 * The full-fat behavior (mtime cache, dismiss persistence,
 * terminal_prompt post-pass, ask_tool precedence) is covered by
 * routes.test.ts. This file locks the response-key contract for the
 * standalone sub-router.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { createInboxRouter } from "../routes.js";
import { clearInboxDeriveCache } from "../_cache.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../../core/session-watcher.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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

async function makeApp(): Promise<{ app: Hono; store: SdkSessionsStore }> {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const watcher = new SessionWatcher({ projectsDir: "/projects" });
  const app = new Hono();
  app.route(
    "/",
    createInboxRouter({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return { app, store };
}

describe("createInboxRouter — GET /api/external/inbox", () => {
  beforeEach(() => clearInboxDeriveCache());

  it("200 returns { items: [] } when no tasks are tracked", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/inbox");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("200 still returns { items: [] } when tasks exist but no JSONL is on disk", async () => {
    const { app, store } = await makeApp();
    store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request("/api/external/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});

describe("createInboxRouter — POST /api/external/inbox/:toolUseId/dismiss", () => {
  beforeEach(() => clearInboxDeriveCache());

  it("404 toolUseId not found when nothing is pending", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/inbox/tu-unknown/dismiss", {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("200 returns { ok, taskId } when the toolUseId matches a tracked task", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      inbox: {
        pendingToolUseIds: ["tu-pending"],
        dismissedToolUseIds: [],
        lastProcessedByteOffset: 0,
      },
    });

    const res = await app.request("/api/external/inbox/tu-pending/dismiss", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; taskId: string };
    expect(body.ok).toBe(true);
    expect(body.taskId).toBe(task.taskId);
    // Verify dismissed set is persisted.
    const after = store.get(task.taskId)!;
    expect(after.inbox.dismissedToolUseIds).toContain("tu-pending");
    expect(after.inbox.pendingToolUseIds).not.toContain("tu-pending");
  });
});
