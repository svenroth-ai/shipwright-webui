/*
 * routes.lead-fields-tag-filter-create.test.ts —
 * iterate-2026-08-16-v1-lead-fields-tag-filter (triage-v1-v4a.md Item 1).
 *
 * POST /api/external/tasks — leadParentTaskId (AC5-AC7). Split out of the
 * original combined routes.lead-fields-tag-filter.test.ts (313 lines) to
 * clear the 300-line bloat gate; see _lead-fields-tag-filter-harness.ts for
 * the shared in-memory harness and sibling files -patch.test.ts /
 * -list.test.ts for the other two AC groups.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { STORE_PATH, inMemoryDeps, makeApp } from "./_lead-fields-tag-filter-harness.js";

describe("POST /api/external/tasks — leadParentTaskId (AC5-AC7)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let deps: SdkSessionsStoreDeps;

  beforeEach(async () => {
    deps = inMemoryDeps();
    store = new SdkSessionsStore(STORE_PATH, deps);
    await store.load();
    app = makeApp(store, new SessionWatcher({ projectsDir: "/fake/projects" }));
  });

  async function create(body: Record<string, unknown>) {
    return app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "t", cwd: "/tmp", ...body }),
    });
  }

  // @covers FR-01.01
  it("AC5: persists leadParentTaskId and round-trips after reload", async () => {
    const res = await create({ leadParentTaskId: "lead-task-root" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { taskId: string; leadParentTaskId?: string } };
    expect(json.task.leadParentTaskId).toBe("lead-task-root");

    // No explicit store.persist() — create.ts already persists internally;
    // reloading straight off `deps` proves the ROUTE persisted, not just
    // the in-memory create() call (external review, openai finding 2).
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    expect(reloaded.get(json.task.taskId)!.leadParentTaskId).toBe("lead-task-root");
  });

  // @covers FR-01.01
  it("AC6: empty-string leadParentTaskId is soft-dropped (not stored)", async () => {
    const res = await create({ leadParentTaskId: "" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { leadParentTaskId?: string } };
    expect(json.task.leadParentTaskId).toBeUndefined();
  });

  // @covers FR-01.01
  it("AC7: poFeedback is NOT accepted on create (regression — PATCH-only)", async () => {
    const res = await create({ poFeedback: "should not be creatable" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBeUndefined();
  });
});
