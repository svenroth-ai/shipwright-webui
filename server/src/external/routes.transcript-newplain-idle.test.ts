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

describe("AC-1 — transcript poll patches new-plain `active → idle` when pty is gone", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  async function setupWithPty(liveTaskIds: string[] = []) {
    projectsDir = mkdtempSync(path.join(tmpdir(), "ac1-newplain-idle-"));
    const deps = inMemoryDeps();
    store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: makePtyManagerStub(liveTaskIds),
      }),
    );
  }

  beforeEach(async () => {
    await setupWithPty();
  });

  async function createTask(opts: { actionId?: string; title?: string }): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: opts.title ?? "t", cwd: "/tmp", actionId: opts.actionId }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task.taskId;
  }

  async function patchState(taskId: string, state: string) {
    store.patch(taskId, { state: state as never });
    await store.persist();
  }

  async function pollTranscript(taskId: string) {
    const res = await app.request(`/api/external/tasks/${taskId}/transcript`);
    return { status: res.status, body: (await res.json()) as { task: { state: string } } };
  }

  it("patches new-plain + active + no-pty to `idle` on transcript poll", async () => {
    const taskId = await createTask({ actionId: "new-plain", title: "newplain-overnight" });
    await patchState(taskId, "active");

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("idle");
  });

  it("does NOT patch when pty is still alive (live pty entry)", async () => {
    const taskId = await createTask({ actionId: "new-plain", title: "newplain-live-pty" });
    await patchState(taskId, "active");

    // Re-construct the app with the task-id reported as live pty entry.
    await setupWithPty([taskId]);
    // Re-create the same task in the new store (test uses fresh store per setup).
    const newTaskId = await createTask({ actionId: "new-plain", title: "newplain-live-pty" });
    await patchState(newTaskId, "active");
    // Make pty live for the actual created id.
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir }),
        ptyManager: makePtyManagerStub([newTaskId]),
      }),
    );

    const { body } = await pollTranscript(newTaskId);
    expect(body.task.state).toBe("active");
  });

  it("does NOT patch slash-command-launch tasks (only new-plain gate fires)", async () => {
    const taskId = await createTask({ actionId: "new-iterate-build", title: "slash-task" });
    await patchState(taskId, "active");

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("active");
  });

  it("is idempotent: subsequent polls do not flap state once patched", async () => {
    const taskId = await createTask({ actionId: "new-plain", title: "idempotent" });
    await patchState(taskId, "active");

    const first = await pollTranscript(taskId);
    expect(first.body.task.state).toBe("idle");

    // Re-poll N=3 times
    const second = await pollTranscript(taskId);
    const third = await pollTranscript(taskId);
    const fourth = await pollTranscript(taskId);
    expect(second.body.task.state).toBe("idle");
    expect(third.body.task.state).toBe("idle");
    expect(fourth.body.task.state).toBe("idle");
  });

  it("does NOT patch when state is already `idle` (no-op short-circuit)", async () => {
    const taskId = await createTask({ actionId: "new-plain", title: "already-idle" });
    await patchState(taskId, "idle");

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("idle");
  });
});
