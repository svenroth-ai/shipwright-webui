/*
 * external/tasks/__tests__/routes.test.ts — per-router contract for
 * the 8 task lifecycle endpoints. The full-fat behavior (PATCH error
 * matrix, fork command emission, backlog state machine, DELETE cascade)
 * is covered by routes.test.ts + routes.edit-fields.test.ts +
 * routes.backlog.test.ts + routes.delete-cascade.test.ts. This file
 * locks the response-key contract for the standalone sub-router.
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

describe("createTasksRouter — POST /api/external/tasks", () => {
  it("200 returns { task } with auto-generated taskId + sessionUuid", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello", cwd: "/projects/test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { taskId: string; title: string; sessionUuid: string };
    };
    expect(body.task.title).toBe("Hello");
    expect(typeof body.task.taskId).toBe("string");
    expect(typeof body.task.sessionUuid).toBe("string");
  });

  it("400 invalid_phase_task_id on malformed phaseTaskId", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "t",
        cwd: "/c",
        phaseTaskId: "not-a-valid-id",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_phase_task_id");
  });
});

describe("createTasksRouter — GET /api/external/tasks", () => {
  it("200 returns { tasks: [...] }", async () => {
    const { app, store } = await makeApp();
    store.create({ title: "t1", cwd: "/c", pluginDirs: [] });
    const res = await app.request("/api/external/tasks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ title: string }> };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe("t1");
  });
});

describe("createTasksRouter — GET /api/external/tasks/:id", () => {
  it("404 Task not found when id is unknown", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Task not found");
  });

  it("200 returns { task } with the augmented liveSession field", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { taskId: string; liveSession: boolean };
    };
    expect(body.task.taskId).toBe(t.taskId);
    expect(body.task.liveSession).toBe(false);
  });
});

describe("createTasksRouter — PATCH /api/external/tasks/:id", () => {
  it("404 Task not found", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("400 at_least_one_field_required when body is empty", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("at_least_one_field_required");
  });

  it("400 title cannot be empty on whitespace-only title", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot be empty");
  });

  // CLAUDE.md rule 6 — multi-writer state files MUST use proper-lockfile,
  // the PATCH endpoint surfaces ELOCKED as 409 so the client can retry
  // instead of silently overwriting. Forces store.persist to throw ELOCKED.
  it("409 ELOCKED → 'sdk-sessions.json is locked, retry' (rule 6)", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    // Patch persist to throw ELOCKED on the next call.
    const originalPersist = store.persist.bind(store);
    let calls = 0;
    store.persist = async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("Lock file is held"), {
          code: "ELOCKED",
        });
      }
      return originalPersist();
    };
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "renamed" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("sdk-sessions.json is locked, retry");
  });
});

describe("createTasksRouter — POST /api/external/tasks/:id/close", () => {
  it("404 Task not found", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing/close", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("200 returns { task } with state=done", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}/close`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { state: string } };
    expect(body.task.state).toBe("done");
  });
});

describe("createTasksRouter — DELETE /api/external/tasks/:id", () => {
  it("404 Task not found", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("200 returns { ok: true }", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
