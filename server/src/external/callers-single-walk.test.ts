/*
 * iterate-2026-07-22-transcript-cursor-single-walk — AC-4, the OTHER two callers.
 *
 * `session-watcher.single-walk.test.ts` proves the reader can skip its walk when
 * handed a location, and `transcript/__tests__/routes.single-walk.test.ts`
 * proves the transcript route uses the one it gets back. Neither proves that
 * the two callers which must PASS a location actually do — and AC-4 names all
 * three (external diff review, openai: "a caller failing to pass `location`
 * would not be caught by the asserted acceptance criterion").
 *
 * Both walk first by necessity: mission-context needs `sizeBytes` to compute a
 * tail offset, and the inbox cold path walks for its own cache. So for them the
 * saving comes from the INPUT, not the return value, and the assertion has to
 * be a readdir count taken across the real call path.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionWatcher } from "../core/session-watcher.js";
import { createWiredMissionContextRouter } from "./mission-context/wire.js";
import { deriveInboxFromJsonl } from "./inbox/_derive.js";
import type { SdkSessionsStore, ExternalTask } from "../core/sdk-sessions-store.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";

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

/** A real watcher over a real temp tree, counting projects-dir listings. */
function countingWatcher(transcript: string): {
  watcher: SessionWatcher;
  walks: () => number;
} {
  projectsDir = mkdtempSync(path.join(tmpdir(), "callers-walk-"));
  const enc = path.join(projectsDir, "enc");
  mkdirSync(enc, { recursive: true });
  writeFileSync(path.join(enc, `${UUID}.jsonl`), transcript, "utf-8");

  let walks = 0;
  const dir = projectsDir;
  const watcher = new SessionWatcher({
    projectsDir: dir,
    readdir: async (p) => {
      if (path.resolve(p) === path.resolve(dir)) walks++;
      return readdir(p);
    },
  });
  return { watcher, walks: () => walks };
}

function task(over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: UUID,
    title: "t",
    cwd: "/c",
    state: "active",
    projectId: "proj-1",
    pluginDirs: [],
    inbox: { dismissedToolUseIds: [], pendingToolUseIds: [] },
    ...over,
  } as unknown as ExternalTask;
}

describe("mission-context poll — ONE ~/.claude/projects walk (AC-4)", () => {
  it("hands its already-resolved location to readChunk instead of walking twice", async () => {
    const { watcher, walks } = countingWatcher('{"type":"user"}\n{"type":"assistant"}\n');
    const tasks = new Map([["task-1", task()]]);
    const store = {
      get: (id: string) => tasks.get(id),
      patch: (id: string, patch: Partial<ExternalTask>) => {
        const t = tasks.get(id);
        if (t) Object.assign(t, patch);
        return t;
      },
      persist: async () => {},
    } as unknown as SdkSessionsStore;

    const projectRoot = mkdtempSync(path.join(tmpdir(), "mc-wire-"));
    const app = createWiredMissionContextRouter({
      store,
      watcher,
      getProjectById: (id) =>
        id === "proj-1" ? { id: "proj-1", name: "P", path: projectRoot } : undefined,
      readRunConfig: async () => ({ status: "missing" }) as never,
    });

    const before = walks();
    const res = await app.request("/api/external/tasks/task-1/mission-context");
    expect(res.status).toBe(200);
    // Pre-change: 2 — the wire's own `findByUuid`, then `readChunk`'s.
    expect(walks() - before).toBe(1);

    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe("inbox cold-path derive — ONE ~/.claude/projects walk (AC-4)", () => {
  it("hands its already-resolved location to readChunk instead of walking twice", async () => {
    const { watcher, walks } = countingWatcher('{"type":"user","message":{"content":"hi"}}\n');
    const rows = [task()];
    const store = {
      list: () => rows,
      get: (id: string) => rows.find((r) => r.taskId === id),
      patch: (id: string, patch: Partial<ExternalTask>) => {
        const t = rows.find((r) => r.taskId === id);
        if (t) Object.assign(t, patch);
        return t;
      },
      persist: async () => {},
    } as unknown as SdkSessionsStore;

    const before = walks();
    await deriveInboxFromJsonl({ store, watcher });
    // The COLD path specifically — no cache entry exists on a first derive, so
    // this is the branch that used to walk, discard, and walk again.
    expect(walks() - before).toBe(1);
  });
});
