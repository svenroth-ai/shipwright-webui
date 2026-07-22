/*
 * iterate-2026-07-22-transcript-cursor-single-walk — AC-5.
 *
 * The transcript route used to resolve the JSONL twice per poll: once inside
 * `readChunk` for the bytes, then again via `findByUuid` for the mtime that
 * drives the active/idle decay. It now reads the mtime off the location
 * `readChunk` hands back.
 *
 * What must NOT change: every state transition, the persisted
 * `lastJsonlSeenMtimeMs`, and the response body. What DOES change, deliberately:
 * a JSONL deleted between the two former walks used to yield `mtime = 0`, which
 * `now - 0 > ACTIVE_IDLE_THRESHOLD_MS` read as "idle for 40 years" and idled a
 * live task. One walk cannot disagree with itself.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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

let projectsDir = "";
afterEach(() => {
  if (projectsDir) {
    try {
      rmSync(projectsDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  projectsDir = "";
});

async function makeApp(): Promise<{
  app: Hono;
  store: SdkSessionsStore;
  walks: () => number;
  seedJsonl: (taskId: string, content?: string) => string;
}> {
  projectsDir = mkdtempSync(path.join(tmpdir(), "one-walk-"));
  const dir = projectsDir;
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();

  let walkCount = 0;
  const watcher = new SessionWatcher({
    projectsDir: dir,
    readdir: async (p) => {
      if (path.resolve(p) === path.resolve(dir)) walkCount++;
      return readdir(p);
    },
  });
  const app = new Hono();
  app.route(
    "/",
    createTranscriptRouter({ store, watcher, ptyManager: { get: () => undefined } }),
  );

  const seedJsonl = (taskId: string, content = "line-a\nline-b\n"): string => {
    const task = store.get(taskId)!;
    const enc = path.join(dir, "enc");
    mkdirSync(enc, { recursive: true });
    const fp = path.join(enc, `${task.sessionUuid}.jsonl`);
    writeFileSync(fp, content, "utf-8");
    return fp;
  };

  return { app, store, walks: () => walkCount, seedJsonl };
}

describe("transcript poll — ONE ~/.claude/projects walk (AC-4/AC-5)", () => {
  it("an ok poll walks the projects dir exactly once", async () => {
    const { app, store, walks, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active", launchedAt: new Date().toISOString() });
    seedJsonl(task.taskId);

    const before = walks();
    const res = await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
    // Pre-change: 2 (readChunk's, then the route's own findByUuid for mtime).
    expect(walks() - before).toBe(1);
  });

  it("a missing poll still walks exactly once", async () => {
    const { app, store, walks } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const before = walks();
    const res = await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    expect(((await res.json()) as { status: string }).status).toBe("missing");
    expect(walks() - before).toBe(1);
  });

  it("ten polls cost ten walks, not twenty", async () => {
    const { app, store, walks, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active", launchedAt: new Date().toISOString() });
    seedJsonl(task.taskId);

    const before = walks();
    for (let i = 0; i < 10; i++) {
      await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    }
    expect(walks() - before).toBe(10);
  });
});

describe("transcript poll — the mtime the route acts on is unchanged (AC-5)", () => {
  it("persists lastJsonlSeenMtimeMs equal to the file's real mtime", async () => {
    const { app, store, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active", launchedAt: new Date().toISOString() });
    const fp = seedJsonl(task.taskId);

    await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    const stored = store.get(task.taskId)!;
    expect(stored.lastJsonlSeenMtimeMs).toBe(statSync(fp).mtimeMs);
  });

  it("an active task whose JSONL went cold still decays to idle", async () => {
    const { app, store, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      state: "active",
      launchedAt: new Date().toISOString(),
      firstJsonlObservedAt: new Date().toISOString(),
    });
    const fp = seedJsonl(task.taskId);
    // Backdate well past ACTIVE_IDLE_THRESHOLD_MS.
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(fp, old, old);

    const res = await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    const body = (await res.json()) as { status: string; task: { state: string } };
    expect(body.status).toBe("ok");
    expect(body.task.state).toBe("idle");
  });

  it("an active task with a fresh JSONL stays active", async () => {
    const { app, store, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, {
      state: "active",
      launchedAt: new Date().toISOString(),
      firstJsonlObservedAt: new Date().toISOString(),
    });
    seedJsonl(task.taskId);

    const res = await app.request(`/api/external/tasks/${task.taskId}/transcript`);
    const body = (await res.json()) as { task: { state: string } };
    expect(body.task.state).toBe("active");
  });
});

describe("transcript poll — the route keeps a FRESH fingerprint (plan review, openai #3)", () => {
  it("still reports rotated after the JSONL shrinks", async () => {
    const { app, store, seedJsonl } = await makeApp();
    const task = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(task.taskId, { state: "active", launchedAt: new Date().toISOString() });
    const fp = seedJsonl(task.taskId, "aaaa\nbbbb\ncccc\n");

    const first = (await (
      await app.request(`/api/external/tasks/${task.taskId}/transcript?fromByte=0`)
    ).json()) as { status: string; chunk: { fingerprint: string; toByte: number } };
    expect(first.status).toBe("ok");

    // Shrink it — a new session reusing the uuid, or Claude rewriting the file.
    writeFileSync(fp, "z\n", "utf-8");

    const second = (await (
      await app.request(
        `/api/external/tasks/${task.taskId}/transcript?fromByte=${first.chunk.toByte}` +
          `&expectFingerprint=${encodeURIComponent(first.chunk.fingerprint)}`,
      )
    ).json()) as { status: string };
    // The route does NOT pass a location into readChunk, precisely so the
    // fingerprint is computed from a walk taken during THIS poll. A stale
    // fingerprint here would silently swallow the rotation.
    expect(second.status).toBe("rotated");
  });
});
