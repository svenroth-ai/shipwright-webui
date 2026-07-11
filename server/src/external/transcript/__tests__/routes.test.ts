/*
 * external/transcript/__tests__/routes.test.ts — per-router contract for
 * GET /api/external/tasks/:id/transcript.
 *
 * The full-fat behavior (active/idle decay, jsonl_missing transitions,
 * new-plain pty-up exception) is covered by routes.test.ts +
 * routes.transcript-newplain-*.test.ts. This file locks the stateless
 * byte-offset contract (CLAUDE.md rule 4) and the basic status
 * discriminated union for the standalone sub-router.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTranscriptRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../../core/session-watcher.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p))
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

async function makeApp(): Promise<{ app: Hono; store: SdkSessionsStore }> {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const watcher = new SessionWatcher({ projectsDir: "/projects" });
  const app = new Hono();
  app.route(
    "/",
    createTranscriptRouter({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return { app, store };
}

describe("createTranscriptRouter — GET /api/external/tasks/:id/transcript", () => {
  it("404 Task not found", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing/transcript");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Task not found");
  });

  it("200 returns status='missing' + task when JSONL does not exist", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(
      `/api/external/tasks/${task.taskId}/transcript`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; task: unknown };
    expect(body.status).toBe("missing");
    expect(body.task).toBeDefined();
  });

  it("stateless byte-offset: two parallel fetches return identical body bytes (rule 4)", async () => {
    const { app, store } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });

    const [r1, r2] = await Promise.all([
      app.request(
        `/api/external/tasks/${task.taskId}/transcript?fromByte=0`,
      ),
      app.request(
        `/api/external/tasks/${task.taskId}/transcript?fromByte=0`,
      ),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Strong-form rule 4 check: NOT just same status — same RAW BYTES.
    // A broken implementation that returned different chunks per request
    // with the same `"missing"` status would pass a status-only check but
    // fail this one (external code review HIGH 2026-05-26).
    const text1 = await r1.text();
    const text2 = await r2.text();
    expect(text1).toBe(text2);
    // Also assert the discriminator: with no JSONL on disk both must be
    // `status: "missing"` (the documented multi-tab probe outcome).
    expect(JSON.parse(text1).status).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// D06 (iterate-2026-07-10-transcript-state-guards) — F04 + F23 regression.
//
// F04: the transcript-poll state machine must NEVER resurrect a terminal
// state (done / launch_failed) — neither the missing-branch flip to
// jsonl_missing nor the ok-branch resurrection to active. A task completed
// and closed weeks ago (Claude's 30-day cleanupPeriodDays deletes its
// JSONL) must stay `done` when the user re-opens its Done card.
//
// F23: the ok-branch must only store.patch + persist when a value actually
// changed — an idle task whose JSONL mtime is unchanged for hours must not
// rewrite sdk-sessions.json (a full JSON.stringify of ALL tasks) on every
// 1 s poll.
// ---------------------------------------------------------------------------

function spyPersist(store: SdkSessionsStore): { count: () => number } {
  let n = 0;
  const orig = store.persist.bind(store);
  store.persist = (async () => {
    n++;
    return orig();
  }) as typeof store.persist;
  return { count: () => n };
}

/**
 * Spy on `store.patch` for a specific task. External code review (openai
 * low) — a no-op poll must skip BOTH patch and persist; spying persist alone
 * would pass an impl that still mutates the in-memory row every poll.
 */
function spyPatch(store: SdkSessionsStore, taskId: string): { count: () => number } {
  let n = 0;
  const orig = store.patch.bind(store);
  store.patch = ((id: string, p: Partial<import("../../../core/sdk-sessions-store.js").ExternalTask>) => {
    if (id === taskId) n++;
    return orig(id, p);
  }) as typeof store.patch;
  return { count: () => n };
}

describe("D06 — transcript poll never resurrects terminal-state tasks (F04)", () => {
  async function makeMissingApp(): Promise<{ app: Hono; store: SdkSessionsStore }> {
    // projectsDir points at a path that does not exist → findByUuid returns
    // null → readChunk reports `missing`, exercising the missing-branch.
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/does-not-exist" });
    const app = new Hono();
    app.route(
      "/",
      createTranscriptRouter({
        store,
        watcher,
        ptyManager: { get: () => undefined },
      }),
    );
    return { app, store };
  }

  for (const terminal of ["done", "launch_failed"] as const) {
    it(`missing-branch: state=${terminal} + JSONL gone stays ${terminal} with ZERO persists`, async () => {
      const { app, store } = await makeMissingApp();
      const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
      // A completed/failed task that once produced a JSONL.
      store.patch(task.taskId, {
        state: terminal,
        firstJsonlObservedAt: new Date().toISOString(),
      });
      await store.persist();

      const persist = spyPersist(store);
      const patch = spyPatch(store, task.taskId);
      const res = await app.request(
        `/api/external/tasks/${task.taskId}/transcript`,
      );
      const body = (await res.json()) as { status: string; task: { state: string } };
      expect(body.status).toBe("missing");
      expect(body.task.state).toBe(terminal);
      // Fully immutable → no in-memory patch AND no persist. (Pre-fix:
      // flipped to jsonl_missing + persisted.)
      expect(patch.count()).toBe(0);
      expect(persist.count()).toBe(0);
    });
  }
});

describe("D06 — ok-branch guards (F04 resurrect-to-active + F23 dirty-check)", () => {
  let projectsDir: string;
  afterEach(() => {
    try {
      rmSync(projectsDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function makeOkApp(): Promise<{ app: Hono; store: SdkSessionsStore }> {
    projectsDir = mkdtempSync(path.join(tmpdir(), "d06-ok-"));
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    const app = new Hono();
    app.route(
      "/",
      createTranscriptRouter({
        store,
        watcher,
        ptyManager: { get: () => undefined },
      }),
    );
    return { app, store };
  }

  function seedJsonl(store: SdkSessionsStore, taskId: string): void {
    const task = store.get(taskId)!;
    const enc = path.join(projectsDir, "enc");
    mkdirSync(enc, { recursive: true });
    writeFileSync(
      path.join(enc, `${task.sessionUuid}.jsonl`),
      "line-a\nline-b\n",
      "utf-8",
    );
  }

  for (const terminal of ["done", "launch_failed"] as const) {
    it(`ok-branch: a ${terminal} task with JSONL on disk (no firstJsonlObservedAt) is NOT resurrected to active`, async () => {
      // The "too-narrow firstJsonlObservedAt exemption": pre-fix, the
      // `!firstJsonlObservedAt` arm flipped ANY non-draft task to active, so
      // a terminal task whose firstJsonlObservedAt was never recorded got
      // yanked back to `active` the moment a JSONL appeared under its uuid.
      const { app, store } = await makeOkApp();
      const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
      store.patch(task.taskId, { state: terminal }); // firstJsonlObservedAt unset
      await store.persist();
      seedJsonl(store, task.taskId);

      const patch = spyPatch(store, task.taskId);
      const persist = spyPersist(store);
      const res = await app.request(
        `/api/external/tasks/${task.taskId}/transcript`,
      );
      const body = (await res.json()) as { status: string; task: { state: string } };
      expect(body.status).toBe("ok");
      expect(body.task.state).toBe(terminal);
      // Fully immutable from poll results: no state flip, no firstJsonlObservedAt
      // backfill, no mtime write → zero patch + zero persist.
      expect(patch.count()).toBe(0);
      expect(persist.count()).toBe(0);
    });
  }

  it("ok-branch: unchanged mtime performs ZERO extra persists across repeated polls (F23 dirty-check)", async () => {
    const { app, store } = await makeOkApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active", launchedAt: new Date().toISOString() });
    await store.persist();
    seedJsonl(store, task.taskId);

    // Warm-up poll — records firstJsonlObservedAt + lastJsonlSeenMtimeMs.
    await app.request(`/api/external/tasks/${task.taskId}/transcript`);

    // Now the row is fully settled and the JSONL mtime is unchanged. Every
    // further poll must be a complete no-op: patch AND persist both skipped.
    const patch = spyPatch(store, task.taskId);
    const persist = spyPersist(store);
    await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    // Pre-fix: 3 persists (one per poll). Post-fix: 0 patch + 0 persist.
    expect(patch.count()).toBe(0);
    expect(persist.count()).toBe(0);
  });
});
