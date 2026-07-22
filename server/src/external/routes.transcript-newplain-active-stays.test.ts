/*
 * routes.transcript-newplain-active-stays.test.ts — iterate v0.9.3 AC-1
 *
 * Regression fence for the state-machine bug surfaced after v0.9.2:
 * Resume click on a `new-plain` task in `idle` state never settled on
 * `active` because the transcript-poll active→idle decay path at
 * `routes.ts:925-926` unconditionally fired when `now - mtime >
 * ACTIVE_IDLE_THRESHOLD_MS` (120s). For `new-plain` tasks the JSONL mtime
 * is meaningless (Claude doesn't write to it until the user types), so
 * mtime stays old even right after a fresh Resume → state ping-pongs
 * idle ↔ active every transcript-poll cycle. User sees Resume button
 * during the idle phase, clicks again, repeat. Empirical reproduction
 * report at task `31b4076d-...` showed 53× launch command copies
 * accumulated in disk-scrollback.
 *
 * AC-1 fix: for `new-plain` tasks with live pty entry, skip the
 * JSONL-mtime-driven `active → idle` decay. pty existence is the
 * authoritative signal — the existing v0.8.7 AC-1 path (result="missing"
 * branch at L889) still handles `active → idle` when pty IS gone.
 *
 * This file covers the result="ok" path (JSONL exists). The result="missing"
 * path is covered by `routes.transcript-newplain-idle.test.ts` (v0.8.7).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

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

function makePtyManagerStub(liveTaskIds: string[] = []): { get: (taskId: string) => unknown } {
  const live = new Set(liveTaskIds);
  return { get: (taskId: string) => (live.has(taskId) ? { taskId } : undefined) };
}

/**
 * Build a SessionWatcher-shaped stub that returns a "ok" status with the
 * configured mtime. Bypasses the real filesystem-scan path so the test
 * deterministically exercises the result="ok" branch of the state machine.
 */
function makeWatcherStub(sessionUuid: string, mtimeOffsetMs: number) {
  // ONE location for both entry points. Since
  // iterate-2026-07-22-…-single-walk the route reads the mtime off
  // `readChunk().location` rather than walking a second time, so a stub whose
  // two answers disagreed would be testing a state the real reader cannot
  // reach — and `stableMtime` is the whole point of this fixture.
  const stableMtime = Date.now() - mtimeOffsetMs;
  const loc = {
    path: "/fake/jsonl",
    encodedCwd: "enc",
    mtimeMs: stableMtime,
    sizeBytes: 1024,
  };
  return {
    findByUuid: async (uuid: string) => (uuid === sessionUuid ? loc : null),
    readChunk: async () => ({
      status: "ok" as const,
      location: loc,
      chunk: {
        fingerprint: "fp-test",
        size: 1024,
        fromByte: 0,
        toByte: 0,
        content: "",
      },
    }),
  } as unknown as SessionWatcher;
}

describe("v0.9.3 AC-1 — transcript poll keeps new-plain `active` when pty is alive (regardless of JSONL mtime)", () => {
  let app: Hono;
  let store: SdkSessionsStore;

  async function setup(opts: {
    liveTaskIds: string[];
    mtimeOffsetMs: number; // > 120_000 to exercise the would-be-decay branch
  }) {
    const deps = inMemoryDeps();
    store = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await store.load();
  }

  beforeEach(async () => {
    await setup({ liveTaskIds: [], mtimeOffsetMs: 300_000 });
  });

  async function createTask(opts: { actionId?: string; title?: string; sessionUuid?: string }): Promise<{ taskId: string; sessionUuid: string }> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: opts.title ?? "t", cwd: "/tmp", actionId: opts.actionId, sessionUuid: opts.sessionUuid }),
    });
    const json = (await res.json()) as { task: { taskId: string; sessionUuid: string } };
    return { taskId: json.task.taskId, sessionUuid: json.task.sessionUuid };
  }

  async function patchState(taskId: string, state: string, extra: Record<string, unknown> = {}) {
    store.patch(taskId, { state: state as never, ...(extra as never) });
    await store.persist();
  }

  async function pollTranscript(taskId: string) {
    const res = await app.request(`/api/external/tasks/${taskId}/transcript`);
    return { status: res.status, body: (await res.json()) as { task: { state: string } } };
  }

  function buildAppForTask(args: {
    sessionUuid: string;
    liveTaskIds: string[];
    mtimeOffsetMs: number;
  }) {
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: makeWatcherStub(args.sessionUuid, args.mtimeOffsetMs),
        ptyManager: makePtyManagerStub(args.liveTaskIds),
      }),
    );
  }

  it("new-plain + active + pty-alive + JSONL stale → state STAYS active (the v0.9.3 fix)", async () => {
    // Bootstrap routes so the create route is reachable.
    buildAppForTask({ sessionUuid: "tmp", liveTaskIds: [], mtimeOffsetMs: 300_000 });
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "newplain-resume" });
    // Simulate post-launch state: state=active + firstJsonlObservedAt set
    // (transcript-poll line 916-919 already flipped awaiting → active).
    await patchState(taskId, "active", { firstJsonlObservedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    // Re-build routes with the actual sessionUuid + the task-id reported as live pty.
    // Mtime stays 5 min old → BEFORE the fix this would trigger active→idle.
    buildAppForTask({ sessionUuid, liveTaskIds: [taskId], mtimeOffsetMs: 5 * 60 * 1000 });

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("active");
  });

  it("new-plain + active + pty-alive + multiple poll cycles → state STAYS active across polls", async () => {
    buildAppForTask({ sessionUuid: "tmp", liveTaskIds: [], mtimeOffsetMs: 300_000 });
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "newplain-loops" });
    await patchState(taskId, "active", { firstJsonlObservedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    buildAppForTask({ sessionUuid, liveTaskIds: [taskId], mtimeOffsetMs: 5 * 60 * 1000 });

    // Poll 5×; state must be active in every response.
    for (let i = 0; i < 5; i++) {
      const { body } = await pollTranscript(taskId);
      expect(body.task.state).toBe("active");
    }
  });

  it("new-plain + active + pty-GONE + JSONL stale → still decays to idle (v0.9.3 scope is strictly 'pty alive')", async () => {
    // Edge case: pty is gone (user closed terminal / shell exited / idle
    // ceiling) BUT JSONL still exists from a prior session (status="ok").
    // The v0.9.3 fix is SCOPED to `pty alive` — when pty is gone we
    // legitimately want active → idle so Resume CTA re-appears. The
    // alternative (stay active forever because JSONL exists) would
    // strand the user on a stale active badge.
    //
    // Note: in practice the v0.8.7 AC-1 path (result="missing" + pty-gone)
    // fires the moment the JSONL is removed/rotated; this test exercises
    // the narrower "JSONL still on disk + pty just died" transient window.
    buildAppForTask({ sessionUuid: "tmp", liveTaskIds: [], mtimeOffsetMs: 300_000 });
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "newplain-pty-gone-jsonl-ok" });
    await patchState(taskId, "active", { firstJsonlObservedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    // pty is NOT in liveTaskIds (gone), JSONL still exists.
    buildAppForTask({ sessionUuid, liveTaskIds: [], mtimeOffsetMs: 5 * 60 * 1000 });

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("idle");
  });

  it("NON-new-plain (slash-command task) + active + JSONL stale → STILL decays to idle (existing behavior preserved)", async () => {
    // The v0.9.3 fix is scoped strictly to actionId === "new-plain".
    // Other actionIds keep the JSONL-mtime-driven decay since they DO
    // write JSONL when claude is alive. Regression fence for the
    // mtime-decay path's continued correctness on non-new-plain.
    buildAppForTask({ sessionUuid: "tmp", liveTaskIds: [], mtimeOffsetMs: 300_000 });
    const { taskId, sessionUuid } = await createTask({ actionId: "new-iterate-build", title: "slash-task" });
    await patchState(taskId, "active", { firstJsonlObservedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    // pty alive doesn't matter for slash-command actionIds — they decay on JSONL mtime.
    buildAppForTask({ sessionUuid, liveTaskIds: [taskId], mtimeOffsetMs: 5 * 60 * 1000 });

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("idle");
  });

  it("new-plain + active + JSONL mtime FRESH (< 120s) → state stays active (already correct pre-fix; regression fence)", async () => {
    buildAppForTask({ sessionUuid: "tmp", liveTaskIds: [], mtimeOffsetMs: 300_000 });
    const { taskId, sessionUuid } = await createTask({ actionId: "new-plain", title: "newplain-fresh" });
    await patchState(taskId, "active", { firstJsonlObservedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    buildAppForTask({ sessionUuid, liveTaskIds: [taskId], mtimeOffsetMs: 30 * 1000 }); // 30s old

    const { body } = await pollTranscript(taskId);
    expect(body.task.state).toBe("active");
  });
});
