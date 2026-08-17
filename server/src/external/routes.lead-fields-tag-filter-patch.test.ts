/*
 * routes.lead-fields-tag-filter-patch.test.ts —
 * iterate-2026-08-16-v1-lead-fields-tag-filter (triage-v1-v4a.md Item 1).
 *
 * PATCH /api/external/tasks/:id — poFeedback (AC1-AC4). Split out of the
 * original combined routes.lead-fields-tag-filter.test.ts (313 lines) to
 * clear the 300-line bloat gate; see _lead-fields-tag-filter-harness.ts for
 * the shared in-memory harness and sibling files -create.test.ts /
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

describe("PATCH /api/external/tasks/:id — poFeedback (AC1-AC4)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let deps: SdkSessionsStoreDeps;

  beforeEach(async () => {
    deps = inMemoryDeps();
    store = new SdkSessionsStore(STORE_PATH, deps);
    await store.load();
    app = makeApp(store, new SessionWatcher({ projectsDir: "/fake/projects" }));
  });

  async function patch(taskId: string, body: Record<string, unknown>) {
    return app.request(`/api/external/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // @covers FR-01.01
  it("AC1: writes poFeedback and echoes it in the response (not a silent no-op)", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    const res = await patch(t.taskId, { poFeedback: "please redo the auth check" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBe("please redo the auth check");
    expect(store.get(t.taskId)!.poFeedback).toBe("please redo the auth check");
  });

  // @covers FR-01.01
  it("AC1: trims like normalizeDescription (mirrors the description block)", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    const res = await patch(t.taskId, { poFeedback: "  trim me please  " });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBe("trim me please");
  });

  // @covers FR-01.01
  it("AC2: succeeds on a STARTED task (poFeedback is not in FROZEN_WHEN_STARTED)", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    // Simulate a started task the way the launch route would.
    store.patch(t.taskId, { launchedAt: new Date().toISOString(), state: "active" });
    const res = await patch(t.taskId, { poFeedback: "still writable after start" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBe("still writable after start");
  });

  // @covers FR-01.01
  it("AC3: empty string clears poFeedback; absent after reload", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    await patch(t.taskId, { poFeedback: "will be cleared" });
    const res = await patch(t.taskId, { poFeedback: "" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBeUndefined();

    // No explicit store.persist() here — the PATCH route already persists
    // internally (patch.ts). Reloading straight off `deps` proves the
    // ROUTE's own persistence, not just the in-memory store's round-trip
    // (external review, openai finding 1: an explicit persist() here would
    // mask a regression where the route stops persisting).
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    expect(reloaded.get(t.taskId)!.poFeedback).toBeUndefined();
    // Not covering multi-writer merge behavior — the lock-less in-memory
    // deps skip mergeSessions entirely (persist()'s `release === null`
    // branch); this proves the undefined-key-drops-from-JSON mechanism.
  });

  // @covers FR-01.01
  it("AC3: null clears poFeedback; absent after reload", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    await patch(t.taskId, { poFeedback: "will be cleared" });
    const res = await patch(t.taskId, { poFeedback: null });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { poFeedback?: string } };
    expect(json.task.poFeedback).toBeUndefined();

    // No explicit store.persist() — see the "" case above for why.
    const reloaded = new SdkSessionsStore(STORE_PATH, deps);
    await reloaded.load();
    expect(reloaded.get(t.taskId)!.poFeedback).toBeUndefined();
  });

  // @covers FR-01.01
  it("AC4: over-length poFeedback -> 400 invalid_po_feedback with the exact detail string", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    const res = await patch(t.taskId, { poFeedback: "x".repeat(6001) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail: string };
    expect(json.error).toBe("invalid_po_feedback");
    expect(json.detail).toBe("poFeedback exceeds 6000 characters");
  });

  // @covers FR-01.01
  it("AC4: exactly 6000 characters is accepted", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    const res = await patch(t.taskId, { poFeedback: "x".repeat(6000) });
    expect(res.status).toBe(200);
  });

  // @covers FR-01.01
  it("AC4: non-string poFeedback -> 400 invalid_po_feedback", async () => {
    const t = store.create({ title: "t", cwd: "/tmp" });
    const res = await patch(t.taskId, { poFeedback: 12345 });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_po_feedback");
  });
});
