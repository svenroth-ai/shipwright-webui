/*
 * routes.backlog.test.ts — iterate-2026-05-17-move-to-backlog (FR-01.32)
 *
 * POST /api/external/tasks/:id/backlog moves an In-Progress task back to
 * the Backlog column (`state → draft`). A pure registry-state flip — no
 * JSONL / run-config write. Plus the transcript-poll stickiness guard:
 * once a task is `draft`, neither the result="ok" nor result="missing"
 * branch of the transcript state machine transitions it out.
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

/** result="ok" watcher stub (real-FS scan bypassed) — see active-stays test. */
function makeOkWatcherStub(sessionUuid: string): SessionWatcher {
  // ONE location, handed back by both `findByUuid` and `readChunk` — the
  // invariant the real reader now guarantees
  // (iterate-2026-07-22-…-single-walk): the location an `ok` chunk reports is
  // the one those bytes were read from. Two independently-built literals here
  // would let the stub drift from a shape the production code cannot produce.
  const loc = {
    path: "/fake/jsonl",
    encodedCwd: "enc",
    mtimeMs: Date.now() - 5_000,
    sizeBytes: 16,
  };
  return {
    findByUuid: async (uuid: string) => (uuid === sessionUuid ? loc : null),
    readChunk: async () => ({
      status: "ok" as const,
      location: loc,
      chunk: { fingerprint: "fp", size: 16, fromByte: 0, toByte: 0, content: "" },
    }),
  } as unknown as SessionWatcher;
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

describe("POST /api/external/tasks/:id/backlog — FR-01.32", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "backlog-route-"));
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
      body: JSON.stringify({ title: "backlog-demo", cwd: "/tmp/whatever" }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  function postBacklog(taskId: string) {
    return app.request(`/api/external/tasks/${taskId}/backlog`, { method: "POST" });
  }

  it.each(IN_PROGRESS)(
    "moves an In-Progress task (state=%s) to draft → 200",
    async (state) => {
      const taskId = await createTask();
      store.patch(taskId, { state });
      const res = await postBacklog(taskId);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { task: { state: string } };
      expect(json.task.state).toBe("draft");
      expect(store.get(taskId)!.state).toBe("draft");
    },
  );

  it("rejects a `done` task with 409 backlog_invalid_state", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "done" });
    const res = await postBacklog(taskId);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; state: string };
    expect(json.error).toBe("backlog_invalid_state");
    expect(json.state).toBe("done");
    // The task is untouched — still done.
    expect(store.get(taskId)!.state).toBe("done");
  });

  it("is idempotent for an already-`draft` task → 200, stays draft", async () => {
    const taskId = await createTask();
    expect(store.get(taskId)!.state).toBe("draft"); // freshly created
    const res = await postBacklog(taskId);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { task: { state: string } };
    expect(json.task.state).toBe("draft");
  });

  it("returns 404 for an unknown task id", async () => {
    const res = await postBacklog("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("preserves every history field — only `state` changes", async () => {
    const taskId = await createTask();
    // Populate the full history surface, then move to backlog.
    store.patch(taskId, {
      state: "idle",
      launchedAt: "2026-05-17T10:00:00.000Z",
      firstJsonlObservedAt: "2026-05-17T10:00:05.000Z",
      lastJsonlSeenMtimeMs: 1_777_000_000_000,
      actionId: "new-iterate-build",
      phase: "build",
      phaseLabel: "Build",
      inbox: {
        pendingToolUseIds: ["tu-1", "tu-2"],
        dismissedToolUseIds: ["tu-0"],
        lastProcessedByteOffset: 4096,
      },
    });
    const before = structuredClone(store.get(taskId)!) as ExternalTask;

    const res = await postBacklog(taskId);
    expect(res.status).toBe(200);

    const after = store.get(taskId)!;
    expect(after.state).toBe("draft");
    // iterate-2026-06-17 — backlog now also syncs boardColumn to Backlog (AC-6).
    expect(after.boardColumn).toBe("backlog");
    // Deep-equal on everything except `state` + `boardColumn`.
    expect({ ...after, state: undefined, boardColumn: undefined }).toEqual({
      ...before,
      state: undefined,
      boardColumn: undefined,
    });
  });

  it("surfaces a persist ELOCKED as 409", async () => {
    const taskId = await createTask();
    store.patch(taskId, { state: "idle" });
    store.persist = async () => {
      throw Object.assign(new Error("sdk-sessions.json is locked"), { code: "ELOCKED" });
    };
    const res = await postBacklog(taskId);
    expect(res.status).toBe(409);
  });
});

describe("transcript poll keeps a backlogged (draft) task sticky", () => {
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "backlog-sticky-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
  });

  function appWith(watcher: SessionWatcher): Hono {
    const app = new Hono();
    app.route(
      "/",
      createExternalRoutes({ store, watcher, ptyManager: { get: () => undefined } }),
    );
    return app;
  }

  async function createTask(): Promise<{ taskId: string; sessionUuid: string }> {
    const bootApp = appWith(new SessionWatcher({ projectsDir }));
    const res = await bootApp.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "sticky", cwd: "/tmp" }),
    });
    const json = (await res.json()) as { task: { taskId: string; sessionUuid: string } };
    return { taskId: json.task.taskId, sessionUuid: json.task.sessionUuid };
  }

  async function poll(app: Hono, taskId: string): Promise<string> {
    const res = await app.request(`/api/external/tasks/${taskId}/transcript`);
    const body = (await res.json()) as { task: { state: string } };
    return body.task.state;
  }

  it("result='missing' branch: draft + firstJsonlObservedAt stays draft (NOT jsonl_missing)", async () => {
    const { taskId } = await createTask();
    // A task moved back to Backlog after it had run: draft, but the JSONL
    // was once observed. A transient probe-miss must not yank it out.
    store.patch(taskId, {
      state: "draft",
      firstJsonlObservedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const app = appWith(makeMissingWatcherStub());
    expect(await poll(app, taskId)).toBe("draft");
    // idempotent across repeated polls
    expect(await poll(app, taskId)).toBe("draft");
  });

  it("result='ok' branch: draft + firstJsonlObservedAt + live JSONL stays draft", async () => {
    const { taskId, sessionUuid } = await createTask();
    store.patch(taskId, {
      state: "draft",
      firstJsonlObservedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const app = appWith(makeOkWatcherStub(sessionUuid));
    expect(await poll(app, taskId)).toBe("draft");
    expect(await poll(app, taskId)).toBe("draft");
  });

  it("result='ok' branch: draft WITHOUT firstJsonlObservedAt — a JSONL appearing must NOT bump it out of the Backlog", async () => {
    // External code review (gemini, HIGH): an `awaiting_external_start`
    // task moved to the Backlog is `draft` with `firstJsonlObservedAt`
    // still UNSET (no poll observed a JSONL yet). The launch was already
    // dispatched, so Claude may still write a JSONL. The next transcript
    // poll's `if (!task.firstJsonlObservedAt)` arm previously flipped the
    // task to `active` — silently yanking it out of the Backlog column.
    const { taskId, sessionUuid } = await createTask();
    store.patch(taskId, {
      state: "draft",
      launchedAt: new Date().toISOString(),
    });
    expect(store.get(taskId)!.firstJsonlObservedAt).toBeUndefined();

    const app = appWith(makeOkWatcherStub(sessionUuid));
    // Sticky: the task stays in the Backlog even as the JSONL appears.
    expect(await poll(app, taskId)).toBe("draft");
    expect(await poll(app, taskId)).toBe("draft");
    // ...but firstJsonlObservedAt IS recorded — so the launch CTA becomes
    // Resume, not a fresh Launch, on the next render (FR-01.01 AC-6).
    expect(store.get(taskId)!.firstJsonlObservedAt).toBeTruthy();
  });
});
