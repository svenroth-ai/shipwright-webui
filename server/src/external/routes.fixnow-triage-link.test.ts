/*
 * routes.fixnow-triage-link.test.ts — iterate-2026-11-09-triage-fixnow-task.
 * POST /api/external/tasks accepts `fixNowForTriageId` (the triage item a
 * Fix-now task was started from); it survives a reload and malformed
 * values are dropped. Distinct from the daemon-owned promotedFromTriageId.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { STORE_PATH, inMemoryDeps, makeApp } from "./_lead-fields-tag-filter-harness.js";

// @covers FR-01.30
describe("POST /api/external/tasks — fixNowForTriageId", () => {
  let app: Hono;
  let deps: SdkSessionsStoreDeps;

  beforeEach(async () => {
    deps = inMemoryDeps();
    const store = new SdkSessionsStore(STORE_PATH, deps);
    await store.load();
    app = makeApp(store, new SessionWatcher({ projectsDir: "/fake/projects" }));
  });

  async function create(body: Record<string, unknown>) {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "t", cwd: "/tmp", ...body }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { task: { taskId: string; fixNowForTriageId?: string; promotedFromTriageId?: string } };
  }

  it("stores a well-formed triage id and keeps it after a reload", async () => {
    const { task } = await create({ fixNowForTriageId: "trg-0a1b2c3d" });
    expect(task.fixNowForTriageId).toBe("trg-0a1b2c3d");
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    expect(reloaded.get(task.taskId)!.fixNowForTriageId).toBe("trg-0a1b2c3d");
  });

  it.each([["TRG-0a1b2c3d"], ["trg-xyz"], ["trg-0a1b2c3d9"], [""], [42], [null]])(
    "drops a malformed id (%j)",
    async (bad) => {
      const { task } = await create({ fixNowForTriageId: bad });
      expect(task.fixNowForTriageId).toBeUndefined();
    },
  );

  it("still refuses to let the public create set promotedFromTriageId", async () => {
    const { task } = await create({ promotedFromTriageId: "trg-0a1b2c3d" });
    expect(task.promotedFromTriageId).toBeUndefined();
  });
});
