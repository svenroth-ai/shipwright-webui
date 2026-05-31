/*
 * routes.reopen.test.ts — iterate-2026-05-31-reopen-done-task
 *
 * POST /api/external/tasks/:id/reopen re-opens a `done` task back to the
 * Backlog column (`state → draft`). Counterpart of /backlog (In-Progress →
 * draft); `done` is the only legal source state. A pure registry-state flip
 * — no JSONL / run-config write, every history field preserved (so the card
 * shows Resume, not a fresh Launch). Plus the transcript-poll stickiness:
 * a reopened (draft + firstJsonlObservedAt) task is NOT yanked back out.
 *
 * Sibling of routes.backlog.test.ts — same in-memory store + watcher stubs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
  type ExternalTask,
  type ExternalTaskState,
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

/** result="missing" watcher stub — JSONL not found. */
function makeMissingWatcherStub(): SessionWatcher {
  return {
    findByUuid: async () => null,
    readChunk: async () => ({ status: "missing" as const }),
  } as unknown as SessionWatcher;
}

const IN_PROGRESS: ExternalTaskState[] = [
  "awaiting_external_start",
  "active",
  "idle",
  "jsonl_missing",
  "launch_failed",
];

describe("POST /api/external/tasks/:id/reopen", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "reopen-route-"));
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
      body: JSON.stringify({ title: "reopen-demo", cwd: "/tmp/whatever" }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  function postReopen(taskId: string) {
    return app.request(`/api/external/tasks/${taskId}/reopen`, { method: "POST" });
  }

  it("re-opens a `done` task to draft → 200", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "done" });
    const res = await postReopen(taskId);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { state: string } };
    expect(json.task.state).toBe("draft");
    expect(store.get(taskId)!.state).toBe("draft");
  });

  it.each(IN_PROGRESS)(
    "rejects an In-Progress task (state=%s) with 409 reopen_invalid_state",
    async (state) => {
      const taskId = await createTask();
      store.patch(taskId, { state });
      const res = await postReopen(taskId);
      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string; state: string };
      expect(json.error).toBe("reopen_invalid_state");
      expect(json.state).toBe(state);
      // Untouched.
      expect(store.get(taskId)!.state).toBe(state);
    },
  );

  it("is idempotent for an already-`draft` task → 200, stays draft", async () => {
    const taskId = await createTask();
    expect(store.get(taskId)!.state).toBe("draft"); // freshly created
    const res = await postReopen(taskId);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { state: string } };
    expect(json.task.state).toBe("draft");
  });

  it("returns 404 for an unknown task id", async () => {
    const res = await postReopen("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("preserves every history field — only `state` changes (session kept for Resume)", async () => {
    const taskId = await createTask();
    store.patch(taskId, {
      state: "done",
      launchedAt: "2026-05-31T10:00:00.000Z",
      firstJsonlObservedAt: "2026-05-31T10:00:05.000Z",
      lastJsonlSeenMtimeMs: 1_777_000_000_000,
      actionId: "new-iterate-build",
      phase: "build",
      phaseLabel: "Build",
    });
    const before = structuredClone(store.get(taskId)!) as ExternalTask;

    const res = await postReopen(taskId);
    expect(res.status).toBe(200);

    const after = store.get(taskId)!;
    expect(after.state).toBe("draft");
    // sessionUuid + launch history retained → TaskCard renders Resume.
    expect(after.sessionUuid).toBe(before.sessionUuid);
    expect(after.firstJsonlObservedAt).toBe(before.firstJsonlObservedAt);
    expect({ ...after, state: undefined }).toEqual({ ...before, state: undefined });
  });

  it("surfaces a persist ELOCKED as 409", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "done" });
    store.persist = async () => {
      throw Object.assign(new Error("sdk-sessions.json is locked"), { code: "ELOCKED" });
    };
    const res = await postReopen(taskId);
    expect(res.status).toBe(409);
  });

  it("transcript poll keeps a reopened (draft) task sticky — not pulled back out", async () => {
    const taskId = await createTask();
    // Reopened: draft, but the JSONL was once observed (the run completed).
    store.patch(taskId, {
      state: "draft",
      firstJsonlObservedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const stickyApp = new Hono();
    stickyApp.route(
      "/",
      createExternalRoutes({
        store,
        watcher: makeMissingWatcherStub(),
        ptyManager: { get: () => undefined },
      }),
    );
    const poll = async () => {
      const res = await stickyApp.request(`/api/external/tasks/${taskId}/transcript`);
      const body = (await res.json()) as { task: { state: string } };
      return body.task.state;
    };
    expect(await poll()).toBe("draft");
    expect(await poll()).toBe("draft");
  });
});
