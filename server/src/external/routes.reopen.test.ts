import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerExternalRoutes } from "./routes.js";
import type { ExternalDeps } from "./types.js";
import { createInMemoryStore } from "./test-helpers.js";

/**
 * POST /api/external/tasks/:id/reopen — counterpart of /backlog.
 * done -> draft (clearing the session), the only legal source state.
 */
describe("POST /api/external/tasks/:id/reopen", () => {
  let app: Hono;
  let deps: ExternalDeps;
  let store: ReturnType<typeof createInMemoryStore>;

  beforeEach(() => {
    app = new Hono();
    deps = makeDeps();
    store = deps.store as ReturnType<typeof createInMemoryStore>;
    registerExternalRoutes(app, deps);
  });

  function makeDeps(): ExternalDeps {
    return {
      store: createInMemoryStore(),
    } as unknown as ExternalDeps;
  }

  it("re-opens a done task to draft and clears the session", async () => {
    const created = await store.createTask({
      title: "Done task",
      projectId: "proj-1",
    });
    await store.updateTask(created.taskId, {
      status: "done",
      sessionId: "session-xyz",
    });

    const res = await app.request(
      `/api/external/tasks/${created.taskId}/reopen`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("draft");
    expect(body.sessionId).toBeNull();
  });

  it("is idempotent — a draft task stays draft (200)", async () => {
    const created = await store.createTask({
      title: "Already draft",
      projectId: "proj-1",
    });

    const res = await app.request(
      `/api/external/tasks/${created.taskId}/reopen`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("draft");
  });

  it("rejects in_progress → reopen with 409 (use /backlog instead)", async () => {
    const created = await store.createTask({
      title: "Active task",
      projectId: "proj-1",
    });
    await store.updateTask(created.taskId, {
      status: "in_progress",
      sessionId: "session-abc",
    });

    const res = await app.request(
      `/api/external/tasks/${created.taskId}/reopen`,
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("invalid_reopen_transition");
  });

  it("returns 404 for a missing task", async () => {
    const res = await app.request(`/api/external/tasks/missing-id/reopen`, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
