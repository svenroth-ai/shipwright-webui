/*
 * routes.edit-fields.test.ts — iterate-2026-05-18-edit-task-dialog
 *
 * Two route surfaces:
 *  - POST /api/external/tasks now persists `description` (the "Save to
 *    Backlog" path previously dropped it entirely).
 *  - PATCH /api/external/tasks/:id widens from title/projectId to also
 *    accept description / phase / priority / complexityHint / domain /
 *    tags / blockedBy, with a lifecycle gate: the four launch-shaping
 *    fields are frozen once the task has started (409 field_not_editable).
 *
 * Clear-vs-omit contract (external review HIGH #2): a key present in the
 * body is an update; an omitted key is untouched; `""` / `null` clears a
 * scalar/enum; `[]` clears an array.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

const PROJECT: ExternalRouteProjectView = {
  id: "p1",
  name: "Project One",
  path: "/fake/project-one",
};

function makeApp(store: SdkSessionsStore): Hono {
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher: new SessionWatcher({ projectsDir: "/fake/projects" }),
      ptyManager: { get: () => undefined },
      getKnownProjectIds: () => new Set([PROJECT.id]),
      getProjectById: (id) => (id === PROJECT.id ? PROJECT : undefined),
    }),
  );
  return app;
}

const STORE_PATH = "/store/sdk-sessions.json";

describe("POST /api/external/tasks — description persistence (AC-3)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let deps: SdkSessionsStoreDeps;

  beforeEach(async () => {
    deps = inMemoryDeps();
    store = new SdkSessionsStore(STORE_PATH, deps);
    await store.load();
    app = makeApp(store);
  });

  async function create(body: Record<string, unknown>) {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "t", cwd: "/tmp", ...body }),
    });
    return res;
  }

  it("persists a non-empty description on create", async () => {
    const res = await create({ description: "do the thing" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { taskId: string; description?: string } };
    expect(json.task.description).toBe("do the thing");
    expect(store.get(json.task.taskId)!.description).toBe("do the thing");
  });

  it("trims the description and drops a whitespace-only one", async () => {
    const res = await create({ description: "   \n  " });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { description?: string } };
    expect(json.task.description).toBeUndefined();
  });

  it("survives a persist + reload round-trip (boundary probe)", async () => {
    const res = await create({ description: "round-trips cleanly" });
    const json = (await res.json()) as { task: { taskId: string } };
    // Fresh store over the same backing files — proves validateExternalTask
    // reads the field back.
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    expect(reloaded.get(json.task.taskId)!.description).toBe("round-trips cleanly");
  });

  it("rejects an over-long description with 400", async () => {
    const res = await create({ description: "x".repeat(20_001) });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/external/tasks/:id — widened fields (AC-1/AC-4)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let deps: SdkSessionsStoreDeps;

  beforeEach(async () => {
    deps = inMemoryDeps();
    store = new SdkSessionsStore(STORE_PATH, deps);
    await store.load();
    app = makeApp(store);
  });

  /** Create a never-started draft task in project p1. */
  async function createTask(): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "edit-me", cwd: "/tmp", projectId: "p1" }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  function patch(taskId: string, body: Record<string, unknown>) {
    return app.request(`/api/external/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("edits description / priority / complexityHint / domain / tags on a never-started task", async () => {
    const taskId = await createTask();
    const res = await patch(taskId, {
      description: "the new brief",
      priority: "P1",
      complexityHint: "medium",
      domain: "auth",
      tags: ["x", "y"],
    });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.description).toBe("the new brief");
    expect(t.priority).toBe("P1");
    expect(t.complexityHint).toBe("medium");
    expect(t.domain).toBe("auth");
    expect(t.tags).toEqual(["x", "y"]);
  });

  it("title-only PATCH still works (regression — FR-01.09)", async () => {
    const taskId = await createTask();
    const res = await patch(taskId, { title: "renamed" });
    expect(res.status).toBe(200);
    expect(store.get(taskId)!.title).toBe("renamed");
  });

  it("projectId-only PATCH still works (regression — Move to project)", async () => {
    const taskId = await createTask();
    const res = await patch(taskId, { projectId: "p1" });
    expect(res.status).toBe(200);
  });

  it("rejects an empty body with 400 at_least_one_field_required", async () => {
    const taskId = await createTask();
    const res = await patch(taskId, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "at_least_one_field_required",
    );
  });

  it("clears a scalar with empty-string and an array with [] (clear-vs-omit)", async () => {
    const taskId = await createTask();
    await patch(taskId, { priority: "P0", domain: "d", tags: ["a"] });
    const res = await patch(taskId, { priority: "", domain: "", tags: [] });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.priority).toBeUndefined();
    expect(t.domain).toBeUndefined();
    expect(t.tags).toEqual([]);
  });

  it("an omitted key is left untouched", async () => {
    const taskId = await createTask();
    await patch(taskId, { priority: "P2", domain: "keep-me" });
    await patch(taskId, { priority: "P3" }); // domain omitted
    const t = store.get(taskId)!;
    expect(t.priority).toBe("P3");
    expect(t.domain).toBe("keep-me");
  });

  it("dedups blockedBy and drops a self-reference", async () => {
    const taskId = await createTask();
    const res = await patch(taskId, {
      blockedBy: ["other-1", "other-1", taskId, "other-2"],
    });
    expect(res.status).toBe(200);
    expect(store.get(taskId)!.blockedBy).toEqual(["other-1", "other-2"]);
  });

  it("rejects an invalid priority / complexityHint with 400", async () => {
    const taskId = await createTask();
    expect((await patch(taskId, { priority: "P9" })).status).toBe(400);
    expect((await patch(taskId, { complexityHint: "huge" })).status).toBe(400);
  });

  it("rejects a non-array tags / blockedBy with 400", async () => {
    const taskId = await createTask();
    expect((await patch(taskId, { tags: "not-array" })).status).toBe(400);
    expect((await patch(taskId, { blockedBy: 7 })).status).toBe(400);
  });

  it("survives a persist + reload round-trip (boundary probe)", async () => {
    const taskId = await createTask();
    await patch(taskId, { priority: "P1", domain: "auth", tags: ["t1"] });
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    const t = reloaded.get(taskId)!;
    expect(t.priority).toBe("P1");
    expect(t.domain).toBe("auth");
    expect(t.tags).toEqual(["t1"]);
  });
});

describe("PATCH — lifecycle gate (AC-2/AC-4 — field_not_editable)", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    app = makeApp(store);
  });

  async function createTask(): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "edit-me", cwd: "/tmp", projectId: "p1" }),
    });
    return ((await res.json()) as { task: { taskId: string } }).task.taskId;
  }

  function patch(taskId: string, body: Record<string, unknown>) {
    return app.request(`/api/external/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a frozen-field edit on a started (active) task with 409", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "active" });
    const res = await patch(taskId, { description: "too late" });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; fields: string[] };
    expect(json.error).toBe("field_not_editable");
    expect(json.fields).toContain("description");
    // The whole PATCH is rejected — nothing changed.
    expect(store.get(taskId)!.description).toBeUndefined();
  });

  it("rejects a frozen-field edit on a draft task that has launchedAt", async () => {
    const taskId = await createTask();
    store.patch(taskId, { launchedAt: "2026-05-18T00:00:00.000Z" });
    const res = await patch(taskId, { phase: "build" });
    expect(res.status).toBe(409);
  });

  it("still allows domain + tags + title on a started task", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "idle" });
    const res = await patch(taskId, {
      domain: "billing",
      tags: ["meta"],
      title: "renamed while running",
    });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.domain).toBe("billing");
    expect(t.tags).toEqual(["meta"]);
    expect(t.title).toBe("renamed while running");
  });

  it("lists every frozen field in a mixed rejected PATCH", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "done" });
    const res = await patch(taskId, {
      description: "x",
      priority: "P1",
      domain: "ok-on-its-own",
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { fields: string[] };
    expect(json.fields.sort()).toEqual(["description", "priority"]);
  });
});

describe("PATCH — phase validation", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    app = makeApp(store);
  });

  function patch(taskId: string, body: Record<string, unknown>) {
    return app.request(`/api/external/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects setting a phase on an unassigned task (phase_requires_project)", async () => {
    // No projectId → defaults to "unassigned" → no catalog to validate against.
    const res0 = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "no-project", cwd: "/tmp" }),
    });
    const taskId = ((await res0.json()) as { task: { taskId: string } }).task.taskId;
    const res = await patch(taskId, { phase: "build" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "phase_requires_project",
    );
  });

  it("sets a valid phase against the project's actions catalog", async () => {
    const res0 = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", cwd: "/tmp", projectId: "p1" }),
    });
    const taskId = ((await res0.json()) as { task: { taskId: string } }).task.taskId;
    const res = await patch(taskId, { phase: "build" });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.phase).toBe("build");
    expect(t.phaseLabel).toBe("Build");
  });

  it("rejects a phase outside the catalog with 400 invalid_phase", async () => {
    const res0 = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", cwd: "/tmp", projectId: "p1" }),
    });
    const taskId = ((await res0.json()) as { task: { taskId: string } }).task.taskId;
    const res = await patch(taskId, { phase: "not-a-real-phase" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_phase");
  });

  it("clears the phase with an empty string (no project needed)", async () => {
    const res0 = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", cwd: "/tmp" }),
    });
    const taskId = ((await res0.json()) as { task: { taskId: string } }).task.taskId;
    store.patch(taskId, { phase: "build", phaseLabel: "Build" });
    const res = await patch(taskId, { phase: "" });
    expect(res.status).toBe(200);
    const t = store.get(taskId)!;
    expect(t.phase).toBeUndefined();
    expect(t.phaseLabel).toBeUndefined();
  });
});
