/*
 * routes.delete-cascade.test.ts — Iterate C (ADR-087, MEDIUM-B1 fix).
 *
 * DELETE /api/external/tasks/:id MUST cascade-clear BOTH:
 *   - scrollback files (`<taskId>.log` + `<taskId>.log.1`) via
 *     `scrollbackClearBestEffort` (existing behavior).
 *   - cell-state snapshot file (`<taskId>.snapshot`) via
 *     `snapshotClearBestEffort` (NEW in Iterate C).
 *
 * Why this matters: snapshots capture rendered terminal cell state and
 * may contain secrets (env vars, file content, prompt history). The
 * 24-h TTL is a backstop — the task delete is the authoritative
 * privacy boundary, so the snapshot file MUST go with the task.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

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

describe("DELETE /tasks/:id — cascade cleanup (Iterate C MEDIUM-B1)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let scrollbackCalls: string[];
  let snapshotCalls: string[];

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/tmp/projects" });
    scrollbackCalls = [];
    snapshotCalls = [];
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async (taskId) => {
          scrollbackCalls.push(taskId);
        },
        snapshotClearBestEffort: async (taskId) => {
          snapshotCalls.push(taskId);
        },
      }),
    );
  });

  async function createTask(title: string): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, cwd: "/tmp" }),
    });
    const j = (await res.json()) as { task: { taskId: string } };
    return j.task.taskId;
  }

  it("invokes BOTH scrollbackClearBestEffort and snapshotClearBestEffort", async () => {
    const taskId = await createTask("t-cascade");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(scrollbackCalls).toEqual([taskId]);
    expect(snapshotCalls).toEqual([taskId]);
  });

  it("succeeds even when snapshot cleanup throws (best-effort)", async () => {
    // Override the snapshot dep to throw.
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir: "/tmp/projects" }),
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async () => {},
        snapshotClearBestEffort: async () => {
          throw new Error("simulated EACCES");
        },
      }),
    );
    const taskId = await createTask("t-fail-snapshot");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
  });

  it("still works when only scrollback dep is wired (snapshot dep omitted)", async () => {
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir: "/tmp/projects" }),
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async (taskId) => {
          scrollbackCalls.push(taskId);
        },
        // snapshotClearBestEffort intentionally omitted.
      }),
    );
    const taskId = await createTask("t-no-snapshot-dep");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(scrollbackCalls).toEqual([taskId]);
  });

  it("returns 404 + does NOT invoke the cascade for an unknown task", async () => {
    const del = await app.request(
      "/api/external/tasks/00000000-0000-0000-0000-000000000000",
      { method: "DELETE" },
    );
    expect(del.status).toBe(404);
    expect(scrollbackCalls).toEqual([]);
    expect(snapshotCalls).toEqual([]);
  });
});
