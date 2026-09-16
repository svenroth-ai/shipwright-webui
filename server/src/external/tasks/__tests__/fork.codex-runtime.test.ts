/*
 * fork.codex-runtime.test.ts — Codex Light §2.1's correction: the fork
 * endpoint does NOT share the main launch chokepoint, so it must inherit
 * `parent.runtime` explicitly at `store.create()` — otherwise a forked
 * Codex task silently becomes a Claude task.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerTasksLifecycle } from "../lifecycle.js";
import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../../../core/sdk-sessions-store.js";

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
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

async function buildApp(checkCodexCliAvailable?: () => Promise<boolean>) {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const app = new Hono();
  registerTasksLifecycle(app, {
    store,
    ptyManager: { get: () => undefined },
    checkCodexCliAvailable,
  });
  return { app, store };
}

describe("POST /tasks/:id/fork — runtime inheritance", () => {
  it("a codex parent's fork stays codex, not the claude default", async () => {
    const { app, store } = await buildApp(async () => true);
    const parent = store.create({ title: "Parent", cwd: "/proj", runtime: "codex" });
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("codex");
    // A codex-runtime fork emits `codex ...` commands, never claude's `--resume`.
    const { commands } = body as unknown as { commands: { posix: string } };
    expect(commands.posix).toContain("codex ");
  });

  it("a claude parent's fork stays claude", async () => {
    const { app, store } = await buildApp();
    const parent = store.create({ title: "Parent", cwd: "/proj" });
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { runtime: string } };
    expect(body.task.runtime).toBe("claude");
  });

  it("AC8 (PR-review preflight finding) — forking a codex parent with no Codex CLI is refused, not silently launched", async () => {
    const { app, store } = await buildApp(async () => false);
    const parent = store.create({ title: "Parent", cwd: "/proj", runtime: "codex" });
    const before = store.list().length;
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("codex_cli_not_found");
    // No orphan child row left behind by the refused fork.
    expect(store.list().length).toBe(before);
  });

  it("a claude parent's fork is never gated on Codex CLI availability", async () => {
    const { app, store } = await buildApp(async () => false);
    const parent = store.create({ title: "Parent", cwd: "/proj" });
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
