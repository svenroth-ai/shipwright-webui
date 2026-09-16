/*
 * external/tasks/__tests__/routes.patch-runtime.test.ts — Codex Light
 * §3.5: PATCH /api/external/tasks/:id must accept and persist the
 * EditTaskModal RuntimeToggle's `runtime` field. Regression test for an
 * external-code-review finding: `runtime` was entirely absent from the
 * route's PATCHABLE list, so a pre-start task flipped to Codex in the
 * modal silently stayed on Claude server-side (200 response, no error,
 * field just dropped).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createTasksRouter } from "../routes.js";
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
    createTasksRouter({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return { app, store };
}

describe("createTasksRouter — PATCH /api/external/tasks/:id — runtime (Codex Light AC1/§3.5)", () => {
  it("persists runtime: \"codex\" on a draft (pre-start) task", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "T", cwd: "/c", pluginDirs: [] });
    expect(task.runtime).toBe("claude");

    const res = await app.request(`/api/external/tasks/${task.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "codex" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("codex");
    expect(store.get(task.taskId)?.runtime).toBe("codex");
  });

  it("400 invalid_runtime on an unrecognized value", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "T", cwd: "/c", pluginDirs: [] });

    const res = await app.request(`/api/external/tasks/${task.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "gpt5" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_runtime");
    expect(store.get(task.taskId)?.runtime).toBe("claude");
  });

  it("409 field_not_editable once the task has started (FROZEN_WHEN_STARTED)", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "T", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active" });

    const res = await app.request(`/api/external/tasks/${task.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtime: "codex" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; fields: string[] };
    expect(body.error).toBe("field_not_editable");
    expect(body.fields).toContain("runtime");
    expect(store.get(task.taskId)?.runtime).toBe("claude");
  });
});
