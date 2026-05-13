/*
 * routes.live-session.test.ts — Iterate G (ADR-095).
 *
 * Asserts that the task-state responses augment each task with
 * `liveSession: boolean`, derived from `PtyManager.get(taskId) !==
 * undefined` at response time. The field is NOT persisted on disk —
 * computed at the wire boundary.
 *
 * Coverage:
 *   - GET /api/external/tasks       (list)
 *   - GET /api/external/tasks/:id   (single)
 *
 * Other endpoints (launch / fork / patch / close / transcript) emit
 * `task` with the same withLiveSession helper applied; they are
 * covered indirectly by the existing routes.test integration suite
 * after the field is added (no new assertion required for them —
 * adding the field is additive + back-compat).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
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

describe("external routes — liveSession augmentation (Iterate G, ADR-095)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;
  let liveIds: Set<string>;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "live-session-test-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    liveIds = new Set<string>();
    app = new Hono();
    // Custom PtyManager-shaped stub — returns "exists" only for taskIds
    // in `liveIds`. This is the surface the routes layer queries via
    // `ptyManager.get(taskId) !== undefined`.
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: {
          get: (taskId: string) => (liveIds.has(taskId) ? { taskId } : undefined),
        },
      }),
    );
  });

  it("GET /tasks returns liveSession=false for tasks without a live pty", async () => {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "no-pty", cwd: "/tmp" }),
    });
    expect(create.status).toBe(200);

    const list = await app.request("/api/external/tasks");
    expect(list.status).toBe(200);
    const json = (await list.json()) as { tasks: Array<{ liveSession: boolean }> };
    expect(json.tasks.length).toBeGreaterThan(0);
    for (const t of json.tasks) {
      expect(t.liveSession).toBe(false);
    }
  });

  it("GET /tasks returns liveSession=true when ptyManager.get returns an entry", async () => {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "live", cwd: "/tmp" }),
    });
    const { task } = (await create.json()) as { task: { taskId: string } };
    liveIds.add(task.taskId);

    const list = await app.request("/api/external/tasks");
    const json = (await list.json()) as {
      tasks: Array<{ taskId: string; liveSession: boolean }>;
    };
    const row = json.tasks.find((t) => t.taskId === task.taskId);
    expect(row).toBeDefined();
    expect(row!.liveSession).toBe(true);
  });

  it("GET /tasks/:id returns liveSession=false for a task without live pty", async () => {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "single-no-pty", cwd: "/tmp" }),
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    const res = await app.request(`/api/external/tasks/${task.taskId}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { liveSession: boolean } };
    expect(json.task.liveSession).toBe(false);
  });

  it("GET /tasks/:id returns liveSession=true when pty exists", async () => {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "single-live", cwd: "/tmp" }),
    });
    const { task } = (await create.json()) as { task: { taskId: string } };
    liveIds.add(task.taskId);

    const res = await app.request(`/api/external/tasks/${task.taskId}`);
    const json = (await res.json()) as { task: { liveSession: boolean } };
    expect(json.task.liveSession).toBe(true);
  });

  it("liveSession is computed at response-time, not persisted on disk", async () => {
    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "flip-flop", cwd: "/tmp" }),
    });
    const { task } = (await create.json()) as { task: { taskId: string } };

    // Initially no live pty.
    let res = await app.request(`/api/external/tasks/${task.taskId}`);
    let json = (await res.json()) as { task: { liveSession: boolean } };
    expect(json.task.liveSession).toBe(false);

    // Pty appears.
    liveIds.add(task.taskId);
    res = await app.request(`/api/external/tasks/${task.taskId}`);
    json = (await res.json()) as { task: { liveSession: boolean } };
    expect(json.task.liveSession).toBe(true);

    // Pty gone.
    liveIds.delete(task.taskId);
    res = await app.request(`/api/external/tasks/${task.taskId}`);
    json = (await res.json()) as { task: { liveSession: boolean } };
    expect(json.task.liveSession).toBe(false);
  });
});
