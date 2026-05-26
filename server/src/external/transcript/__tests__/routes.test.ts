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

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

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
