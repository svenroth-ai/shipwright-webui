/*
 * routes.column.test.ts — iterate-2026-06-17-board-dnd-status-decouple.
 *
 * POST /api/external/tasks/:id/column sets the sticky, user-owned
 * `boardColumn` override ONLY — `state`, JSONL, and run-config are never
 * touched (Status ↔ Resume decoupling). Plus AC-6 coherence: /close,
 * /backlog, /reopen keep `boardColumn` in sync so a prior manual drag
 * cannot strand a card in the wrong column.
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
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

describe("POST /api/external/tasks/:id/column — board-column override", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "column-route-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir }),
        ptyManager: { get: () => undefined },
      }),
    );
  });

  async function createTask(): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "column-demo", cwd: "/tmp/whatever" }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  function postColumn(taskId: string, body: unknown) {
    return app.request(`/api/external/tasks/${taskId}/column`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it.each(["backlog", "in_progress", "done"] as const)(
    "sets boardColumn=%s → 200",
    async (column) => {
      const taskId = await createTask();
      const res = await postColumn(taskId, { column });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { task: { boardColumn: string } };
      expect(json.task.boardColumn).toBe(column);
      expect(store.get(taskId)!.boardColumn).toBe(column);
    },
  );

  it("sets boardColumn ONLY — every other field (state, JSONL, launch meta) untouched", async () => {
    const taskId = await createTask();
    store.patch(taskId, {
      state: "active",
      launchedAt: "2026-06-17T10:00:00.000Z",
      firstJsonlObservedAt: "2026-06-17T10:00:05.000Z",
      lastJsonlSeenMtimeMs: 1_777_000_000_000,
      actionId: "new-iterate-build",
    });
    const before = structuredClone(store.get(taskId)!);

    const res = await postColumn(taskId, { column: "done" });
    expect(res.status).toBe(200);

    const after = store.get(taskId)!;
    // A live (active) task parked in Done keeps its liveness state + history.
    expect(after.boardColumn).toBe("done");
    // Deep-equal on EVERYTHING except boardColumn — proves no JSONL/state churn.
    expect({ ...after, boardColumn: undefined }).toEqual({
      ...before,
      boardColumn: undefined,
    });
  });

  it("rejects an invalid column with 400 invalid_column", async () => {
    const taskId = await createTask();
    const res = await postColumn(taskId, { column: "garbage" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_column");
    expect(store.get(taskId)!.boardColumn).toBeUndefined();
  });

  it("rejects a missing / non-string column with 400 invalid_column", async () => {
    const taskId = await createTask();
    expect((await postColumn(taskId, {})).status).toBe(400);
    expect((await postColumn(taskId, { column: 7 })).status).toBe(400);
  });

  it("404 for an unknown task", async () => {
    const res = await postColumn("does-not-exist", { column: "done" });
    expect(res.status).toBe(404);
  });

  it("is idempotent for an unchanged value → 200", async () => {
    const taskId = await createTask();
    await postColumn(taskId, { column: "in_progress" });
    const res = await postColumn(taskId, { column: "in_progress" });
    expect(res.status).toBe(200);
    expect(store.get(taskId)!.boardColumn).toBe("in_progress");
  });

  describe("AC-6 — menu actions keep boardColumn coherent after a manual drag", () => {
    it("/close → boardColumn=done even after dragging to in_progress", async () => {
      const taskId = await createTask();
      await postColumn(taskId, { column: "in_progress" });
      const res = await app.request(`/api/external/tasks/${taskId}/close`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(store.get(taskId)!.state).toBe("done");
      expect(store.get(taskId)!.boardColumn).toBe("done");
    });

    it("/backlog → boardColumn=backlog even after dragging to done", async () => {
      const taskId = await createTask();
      store.patch(taskId, { state: "active" });
      await postColumn(taskId, { column: "done" });
      const res = await app.request(`/api/external/tasks/${taskId}/backlog`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(store.get(taskId)!.state).toBe("draft");
      expect(store.get(taskId)!.boardColumn).toBe("backlog");
    });

    it("/reopen → boardColumn=backlog from a done task", async () => {
      const taskId = await createTask();
      store.patch(taskId, { state: "done", boardColumn: "done" });
      const res = await app.request(`/api/external/tasks/${taskId}/reopen`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(store.get(taskId)!.state).toBe("draft");
      expect(store.get(taskId)!.boardColumn).toBe("backlog");
    });
  });
});
