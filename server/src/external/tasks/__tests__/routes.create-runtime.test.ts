/*
 * external/tasks/__tests__/routes.create-runtime.test.ts — Codex Light
 * §3.5/AC1: POST /api/external/tasks must read the RuntimeToggle's
 * `runtime` field from the request body and persist it on the created
 * task. Split out from routes.test.ts (which was already at the
 * 300-line guideline) — regression test for a spec-review finding: the
 * route previously parsed every other body field but silently dropped
 * `runtime`, so every task created through the normal UI (NewTaskModal /
 * NewIterateModal / NewPipelineModal, all of which send the toggle's
 * value) landed hard-pinned to "claude" no matter what the operator
 * picked.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createTasksRouter } from "../routes.js";
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
    createTasksRouter({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return { app, store };
}

describe("createTasksRouter — POST /api/external/tasks — runtime (Codex Light AC1)", () => {
  it("persists runtime: \"codex\" when the request body sends it", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Codex task", cwd: "/projects/test", runtime: "codex" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("codex");
  });

  it("defaults to \"claude\" when the request body omits runtime", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Claude task", cwd: "/projects/test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("claude");
  });

  it("rejects an unrecognized runtime value by falling back to \"claude\" (narrowed, not passed through raw)", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T", cwd: "/projects/test", runtime: "gpt5" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("claude");
  });
});
