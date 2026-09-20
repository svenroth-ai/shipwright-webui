/*
 * routes.transcript-newplain-idle.test.ts — iterate v0.8.7 AC-1
 *
 * The transcript-poll endpoint historically had a dead branch for
 * `new-plain` tasks: when JSONL is missing (which it always is for
 * pure Claude TUI launches per `known_issues.md` "Awaiting-launch state"),
 * the `result.status === "missing"` arm returned early before reaching the
 * `active → idle` transition at L877. New-plain tasks therefore stayed on
 * "active" forever after pty-kill (idle-ceiling, server-restart, /close,
 * DELETE cascade), blocking the Resume CTA in the header (per v0.8.5 AC-6
 * matrix: only `idle → Resume`).
 *
 * AC-1 fix: when `result.status === "missing"` AND task is `new-plain`
 * AND state is `active` AND the pty entry is gone (`ptyManager.get()` is
 * undefined), patch state to `idle`. Self-healing — v0.8.5 AC-4 will
 * re-flip on next WS attach.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    _files: files,
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

/** Tiny stub matching the {get(taskId)} contract used by routes for AC-1. */
function makePtyManagerStub(liveTaskIds: string[] = []): { get: (taskId: string) => unknown } {
  const live = new Set(liveTaskIds);
  return { get: (taskId: string) => (live.has(taskId) ? { taskId } : undefined) };
}

/**
 * Shared test harness for both describe blocks below (AC-1 new-plain and
 * iterate-2026-09-20-codex-liveness-transition's Codex-runtime widening) —
 * hoisted per code-review finding (2026-09-20) to avoid a second, driftable
 * copy of the same setup/request helpers.
 */
interface Harness {
  app: Hono;
  store: SdkSessionsStore;
  projectsDir: string;
}

async function setupWithPty(prefix: string, liveTaskIds: string[] = []): Promise<Harness> {
  const projectsDir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const deps = inMemoryDeps();
  const store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
  await store.load();
  const watcher = new SessionWatcher({ projectsDir });
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher,
      ptyManager: makePtyManagerStub(liveTaskIds),
    }),
  );
  return { app, store, projectsDir };
}

async function createTask(
  app: Hono,
  opts: { actionId?: string; title?: string; runtime?: string },
): Promise<string> {
  const res = await app.request("/api/external/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: opts.title ?? "t",
      cwd: "/tmp",
      actionId: opts.actionId,
      runtime: opts.runtime,
    }),
  });
  const json = (await res.json()) as { task: { taskId: string } };
  return json.task.taskId;
}

async function patchState(store: SdkSessionsStore, taskId: string, state: string) {
  store.patch(taskId, { state: state as never });
  await store.persist();
}

async function pollTranscript(app: Hono, taskId: string) {
  const res = await app.request(`/api/external/tasks/${taskId}/transcript`);
  return { status: res.status, body: (await res.json()) as { task: { state: string } } };
}

describe("AC-1 — transcript poll patches new-plain `active → idle` when pty is gone", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setupWithPty("ac1-newplain-idle");
  });

  it("patches new-plain + active + no-pty to `idle` on transcript poll", async () => {
    const taskId = await createTask(h.app, { actionId: "new-plain", title: "newplain-overnight" });
    await patchState(h.store, taskId, "active");

    const { body } = await pollTranscript(h.app, taskId);
    expect(body.task.state).toBe("idle");
  });

  it("does NOT patch when pty is still alive (live pty entry)", async () => {
    const taskId = await createTask(h.app, { actionId: "new-plain", title: "newplain-live-pty" });
    await patchState(h.store, taskId, "active");

    // Re-construct the app with the task-id reported as live pty entry.
    h = await setupWithPty("ac1-newplain-idle");
    // Re-create the same task in the new store (test uses fresh store per setup).
    const newTaskId = await createTask(h.app, { actionId: "new-plain", title: "newplain-live-pty" });
    await patchState(h.store, newTaskId, "active");
    // Make pty live for the actual created id.
    h.app = new Hono();
    h.app.route(
      "/",
      createExternalRoutes({
        store: h.store,
        watcher: new SessionWatcher({ projectsDir: h.projectsDir }),
        ptyManager: makePtyManagerStub([newTaskId]),
      }),
    );

    const { body } = await pollTranscript(h.app, newTaskId);
    expect(body.task.state).toBe("active");
  });

  it("does NOT patch slash-command-launch tasks (only new-plain gate fires)", async () => {
    const taskId = await createTask(h.app, { actionId: "new-iterate-build", title: "slash-task" });
    await patchState(h.store, taskId, "active");

    const { body } = await pollTranscript(h.app, taskId);
    expect(body.task.state).toBe("active");
  });

  it("is idempotent: subsequent polls do not flap state OR re-emit patches once transitioned", async () => {
    // External code review (openai medium): not just "state stays idle"
    // — the underlying `store.patch` call must fire exactly once across
    // repeated polls. An implementation that redundantly calls
    // `patch + persist` on every poll after the first would still keep
    // state=idle but waste IO + potentially churn `sdk-sessions.json`.
    const taskId = await createTask(h.app, { actionId: "new-plain", title: "idempotent" });
    await patchState(h.store, taskId, "active");

    // Spy on store.patch — count calls AFTER baseline state setup.
    const origPatch = h.store.patch.bind(h.store);
    let patchCallsForTask = 0;
    h.store.patch = ((id: string, p: unknown) => {
      if (id === taskId) patchCallsForTask++;
      return origPatch(id, p as never);
    }) as typeof h.store.patch;

    try {
      const first = await pollTranscript(h.app, taskId);
      expect(first.body.task.state).toBe("idle");
      // Exactly ONE patch call so far for this task (the active→idle
      // transition fired once).
      expect(patchCallsForTask).toBe(1);

      // Re-poll N=3 times
      const second = await pollTranscript(h.app, taskId);
      const third = await pollTranscript(h.app, taskId);
      const fourth = await pollTranscript(h.app, taskId);
      expect(second.body.task.state).toBe("idle");
      expect(third.body.task.state).toBe("idle");
      expect(fourth.body.task.state).toBe("idle");
      // Subsequent polls SHORT-CIRCUIT (state===active guard fails) → no
      // additional patches. Total count stays at exactly 1.
      expect(patchCallsForTask).toBe(1);
    } finally {
      h.store.patch = origPatch;
    }
  });

  it("does NOT patch when state is already `idle` (no-op short-circuit)", async () => {
    const taskId = await createTask(h.app, { actionId: "new-plain", title: "already-idle" });
    await patchState(h.store, taskId, "idle");

    const { body } = await pollTranscript(h.app, taskId);
    expect(body.task.state).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// iterate-2026-09-20-codex-liveness-transition — the same `active → idle`
// decay gap applies to Codex-runtime tasks under ANY actionId (a Codex task
// never writes a Claude JSONL either), not just new-plain. Without this, a
// Codex task that reaches `active` via the ws-upgrade-handler.ts sibling fix
// would be stuck `active` forever once its pty is gone.
// ---------------------------------------------------------------------------

describe("Codex-runtime — transcript poll patches `active → idle` when pty is gone", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setupWithPty("codex-idle");
  });

  it("patches codex + active + no-pty to `idle`, under a non-new-plain actionId", async () => {
    const taskId = await createTask(h.app, { actionId: "new-iterate", runtime: "codex", title: "codex-overnight" });
    await patchState(h.store, taskId, "active");

    const { body } = await pollTranscript(h.app, taskId);
    expect(body.task.state).toBe("idle");
  });

  it("does NOT patch a claude-runtime task under a non-new-plain actionId (regression guard)", async () => {
    const taskId = await createTask(h.app, { actionId: "new-iterate", runtime: "claude", title: "claude-slash" });
    await patchState(h.store, taskId, "active");

    const { body } = await pollTranscript(h.app, taskId);
    expect(body.task.state).toBe("active");
  });
});
