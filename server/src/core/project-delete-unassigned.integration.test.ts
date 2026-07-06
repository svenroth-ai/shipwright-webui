/*
 * project-delete-unassigned.integration.test.ts —
 * iterate-2026-07-06-project-delete-cascades-tasks (category: integration).
 *
 * End-to-end proof against the REAL ProjectManager + SdkSessionsStore, wired
 * exactly like index.ts (projectManager.getTaskProjectIds reads the store).
 *
 * The bug: deleting a project at runtime leaves its tasks with a dangling
 * projectId, so ProjectManager.getAll() perpetually synthesizes a phantom
 * "Unassigned" row that the user can't clear. The fix: the DELETE cascade
 * (cascadeDeleteProjectTasks) removes those tasks so the row never appears.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import {
  ProjectManager,
  type ProjectManagerDeps,
  UNASSIGNED_PROJECT_ID,
} from "./project-manager.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "./sdk-sessions-store.js";
import { cascadeDeleteProjectTasks } from "./cascade-delete-project-tasks.js";
import { createProjectRoutes } from "../routes/projects.js";
import { errorHandler } from "../middleware/error-handler.js";

function projectManagerDeps(): ProjectManagerDeps {
  const files = new Map<string, string>();
  return {
    readFile: async (p) => files.get(p) ?? "[]",
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    // Every path "exists" — keeps create()/withMode() probes happy without
    // a real filesystem. hasPreviewCapability falls back to false safely.
    existsSync: () => true,
    mkdirSync: () => {},
    readdirSync: () => [],
  };
}

function sdkStoreDeps(): SdkSessionsStoreDeps {
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

async function wire() {
  const pm = new ProjectManager("/reg/projects.json", projectManagerDeps());
  await pm.load();
  const store = new SdkSessionsStore("/store/sdk-sessions.json", sdkStoreDeps());
  await store.load();
  // index.ts:217 — the synthesized-Unassigned probe reads the live store.
  (pm as unknown as { deps: ProjectManagerDeps }).deps.getTaskProjectIds = () =>
    new Set(store.list().map((t) => t.projectId));
  return { pm, store };
}

function hasUnassignedRow(pm: ProjectManager): boolean {
  return pm.getAll().some((p) => p.id === UNASSIGNED_PROJECT_ID);
}

describe("project delete → Unassigned row (integration)", () => {
  it("without the cascade, deleting a project with tasks leaves a phantom Unassigned row (documents the bug)", async () => {
    const { pm, store } = await wire();
    const p = pm.create({ name: "P1", path: "/p1", profile: "x", status: "active" });
    store.create({ title: "t1", cwd: "/p1", projectId: p.id });
    store.create({ title: "t2", cwd: "/p1", projectId: p.id });

    // Tasks belong to a real project → no synthesized row yet.
    expect(hasUnassignedRow(pm)).toBe(false);

    // Delete the project ONLY (the pre-fix behaviour) — tasks are orphaned.
    pm.delete(p.id);

    // Phantom row appears and its dangling tasks can't be counted under
    // "unassigned" (they still carry p.id) — exactly the reported confusion.
    expect(hasUnassignedRow(pm)).toBe(true);
    expect(store.list().every((t) => t.projectId === p.id)).toBe(true);
  });

  it("with the cascade, deleting the project removes its tasks so NO Unassigned row survives (the fix)", async () => {
    const { pm, store } = await wire();
    const p = pm.create({ name: "P1", path: "/p1", profile: "x", status: "active" });
    store.create({ title: "t1", cwd: "/p1", projectId: p.id });
    store.create({ title: "t2", cwd: "/p1", projectId: p.id });

    pm.delete(p.id);
    const removed = await cascadeDeleteProjectTasks(p.id, { store });

    expect(removed).toBe(2);
    expect(store.list()).toHaveLength(0);
    expect(hasUnassignedRow(pm)).toBe(false);
    // The projects list is empty — the entry is gone after deletion.
    expect(pm.getAll()).toHaveLength(0);
  });

  it("the cascade leaves genuinely-unassigned tasks (and other projects' tasks) untouched", async () => {
    const { pm, store } = await wire();
    const p = pm.create({ name: "P1", path: "/p1", profile: "x", status: "active" });
    const other = pm.create({ name: "P2", path: "/p2", profile: "x", status: "active" });
    store.create({ title: "doomed", cwd: "/p1", projectId: p.id });
    const keep = store.create({ title: "keep", cwd: "/p2", projectId: other.id });
    const free = store.create({ title: "free", cwd: "/x" }); // unassigned

    pm.delete(p.id);
    await cascadeDeleteProjectTasks(p.id, { store });

    const remaining = store.list().map((t) => t.taskId).sort();
    expect(remaining).toEqual([keep.taskId, free.taskId].sort());
    // A genuinely-unassigned task still surfaces the Unassigned row — correct.
    expect(hasUnassignedRow(pm)).toBe(true);
  });

  // Surface proof (F0.5): drive the REAL Hono routes over HTTP — the full
  // chain DELETE /api/projects/:id → cascade → GET /api/projects — so the
  // route wiring + cascade + synthesis compose end-to-end, not just each seam.
  it("HTTP: DELETE /api/projects/:id removes the row AND its tasks so GET shows no Unassigned row", async () => {
    const { pm, store } = await wire();
    const p = pm.create({ name: "P1", path: "/p1", profile: "x", status: "active" });
    store.create({ title: "t1", cwd: "/p1", projectId: p.id });
    store.create({ title: "t2", cwd: "/p1", projectId: p.id });

    const app = new Hono();
    app.onError(errorHandler);
    app.route(
      "/",
      createProjectRoutes(pm, undefined, (projectId) =>
        cascadeDeleteProjectTasks(projectId, { store }),
      ),
    );

    const del = await app.request(`/api/projects/${p.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true, deletedTaskCount: 2 });

    const list = await app.request("/api/projects");
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((row) => row.id === UNASSIGNED_PROJECT_ID)).toBe(false);
    expect(body.data).toHaveLength(0);
    expect(store.list()).toHaveLength(0);
  });
});
