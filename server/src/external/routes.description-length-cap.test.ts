/*
 * routes.description-length-cap.test.ts —
 * iterate-2026-08-13-task-description-length-cap.
 *
 * A task's description is embedded verbatim as a single-line positional
 * argument in the launch command (`{task.initial_prompt}` /
 * `core/actions-substitute.ts`); past DESCRIPTION_MAX_LENGTH the
 * resulting line risks exceeding the Windows interactive console's
 * line-length ceiling and Claude silently fails to start. Both the
 * create and edit routes must reject an over-length description rather
 * than accept it and let the launch command break downstream.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { SdkSessionsStore } from "../core/sdk-sessions-store.js";
import {
  inMemoryDeps,
  makeApp,
  STORE_PATH,
} from "./_routes-edit-fields-harness.js";

describe("POST /api/external/tasks — description length cap", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  beforeEach(async () => {
    store = new SdkSessionsStore(STORE_PATH, inMemoryDeps());
    await store.load();
    app = makeApp(store);
  });

  async function create(body: Record<string, unknown>) {
    return app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "t", cwd: "/tmp", ...body }),
    });
  }

  it("accepts a description right at the cap (6,000 chars)", async () => {
    const description = "x".repeat(6_000);
    const res = await create({ description });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { description?: string } };
    expect(json.task.description).toBe(description);
  });

  it("rejects an over-long description with 400", async () => {
    const res = await create({ description: "x".repeat(6_001) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail: string };
    expect(json).toMatchObject({
      error: "invalid_description",
      detail: "description exceeds 6000 characters",
    });
  });
});

describe("PATCH /api/external/tasks/:id — description length cap", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  beforeEach(async () => {
    store = new SdkSessionsStore(STORE_PATH, inMemoryDeps());
    await store.load();
    app = makeApp(store);
  });

  async function createTask(): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "edit-me", cwd: "/tmp", projectId: "p1" }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  it("rejects an over-long description on PATCH with 400 (create/edit parity)", async () => {
    const taskId = await createTask();
    const res = await app.request(`/api/external/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "x".repeat(6_001) }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; detail: string };
    expect(json).toMatchObject({
      error: "invalid_description",
      detail: "description exceeds 6000 characters",
    });
    expect(store.get(taskId)!.description).toBeUndefined();
  });
});
