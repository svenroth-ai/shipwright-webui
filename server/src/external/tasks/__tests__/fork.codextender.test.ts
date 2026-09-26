/*
 * fork.codextender.test.ts — Codextender integration Part B.6: the fork
 * endpoint (which bypasses the main launch chokepoint — see
 * fork.codex-runtime.test.ts's own header comment) must branch to
 * buildCodextenderCommands and inherit `codexIntegrationMode` when the
 * PARENT is a Codextender-mode task, using the proxy probe instead of the
 * Codex CLI probe for its own AC8-equivalent preflight.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerTasksFork } from "../fork.js";
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

async function buildApp(overrides: {
  checkCodexCliAvailable?: () => Promise<boolean>;
  checkCodextenderProxyAvailable?: () => Promise<boolean>;
  getCodextenderPort?: () => Promise<number | undefined>;
  getCodextenderAuthToken?: () => string | undefined;
  getCodextenderMaxContextTokens?: (port: number) => Promise<number | undefined>;
} = {}) {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const app = new Hono();
  registerTasksFork(app, {
    store,
    ptyManager: { get: () => undefined },
    // Default fixture token so existing Codextender-mode success tests
    // don't each need their own override; the one test that cares about
    // the missing-token block passes its own `() => undefined`.
    getCodextenderAuthToken: () => "test-fixture-token",
    ...overrides,
  });
  return { app, store };
}

async function makeCodextenderParent(store: SdkSessionsStore) {
  const parent = store.create({ title: "Parent", cwd: "/proj", runtime: "codex" });
  store.patch(parent.taskId, { codexIntegrationMode: "codextender" });
  return store.get(parent.taskId)!;
}

describe("POST /tasks/:id/fork — Codextender inheritance", () => {
  it("a Codextender-mode parent's fork inherits codexIntegrationMode and gets buildCodextenderCommands", async () => {
    const { app, store } = await buildApp({ checkCodextenderProxyAvailable: async () => true });
    const parent = await makeCodextenderParent(store);
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { runtime: string; codexIntegrationMode?: string };
      commands: { posix: string };
    };
    expect(body.task.runtime).toBe("codex");
    expect(body.task.codexIntegrationMode).toBe("codextender");
    // Reuses the plain-Claude fork commands (--resume/fork shape), not
    // buildCodexCommands's `codex ...` invocation.
    expect(body.commands.posix).toContain("ANTHROPIC_BASE_URL");
    expect(body.commands.posix).not.toContain("codex ");
  });

  it("a Codex-Light-mode parent's fork is unaffected (still buildCodexCommands)", async () => {
    const { app, store } = await buildApp({ checkCodexCliAvailable: async () => true });
    const parent = store.create({ title: "Parent", cwd: "/proj", runtime: "codex" });
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commands: { posix: string } };
    expect(body.commands.posix).toContain("codex ");
    expect(body.commands.posix).not.toContain("ANTHROPIC_BASE_URL");
  });

  it("refuses (codextender_proxy_unreachable) when the parent is Codextender-mode and the proxy is down, no orphan child row", async () => {
    const { app, store } = await buildApp({ checkCodextenderProxyAvailable: async () => false });
    const parent = await makeCodextenderParent(store);
    const before = store.list().length;
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("codextender_proxy_unreachable");
    expect(store.list().length).toBe(before);
  });

  it("uses the CURRENT getCodextenderPort() value, not a stale one", async () => {
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => true,
      getCodextenderPort: async () => 4100,
    });
    const parent = await makeCodextenderParent(store);
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { commands: { posix: string } };
    expect(body.commands.posix).toContain("http://127.0.0.1:4100");
  });

  it("PR-review BLOCK (iterate-2026-09-23, second round) — refuses (codextender_auth_token_missing) when no auth token is configured, even though the proxy is up, no orphan child row", async () => {
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => true,
      getCodextenderAuthToken: () => undefined,
    });
    const parent = await makeCodextenderParent(store);
    const before = store.list().length;
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("codextender_auth_token_missing");
    expect(store.list().length).toBe(before);
  });

  it("does not probe the Codex CLI at all for a Codextender-mode parent's fork", async () => {
    let codexCliProbed = false;
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => true,
      checkCodexCliAvailable: async () => {
        codexCliProbed = true;
        return true;
      },
    });
    const parent = await makeCodextenderParent(store);
    await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(codexCliProbed).toBe(false);
  });

  it("operator finding (2026-09-26) — sets CLAUDE_CODE_MAX_CONTEXT_TOKENS on the forked child's commands from the resolved probe value", async () => {
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => true,
      getCodextenderMaxContextTokens: async () => 1_050_000,
    });
    const parent = await makeCodextenderParent(store);
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { commands: { posix: string } };
    expect(body.commands.posix).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS='1050000'");
  });

  it("operator finding (2026-09-26) — leaves CLAUDE_CODE_MAX_CONTEXT_TOKENS unset when the probe resolves undefined", async () => {
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => true,
      getCodextenderMaxContextTokens: async () => undefined,
    });
    const parent = await makeCodextenderParent(store);
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { commands: { posix: string } };
    expect(body.commands.posix).not.toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
  });

  it("doubt-review HIGH — a concurrent mutation of the parent's codexIntegrationMode mid-request does not desync the preflight from the command-building branch", async () => {
    // Simulate a second, concurrent request (e.g. the user relaunching the
    // parent task in another tab) flipping the parent's codexIntegrationMode
    // codextender -> light WHILE this fork request's own await points
    // (checkCodextenderProxyAvailable here) are in flight. Before the
    // snapshot fix, the command-building branch re-read the now-mutated
    // `parent.codexIntegrationMode` and could silently skip the CLI check
    // (light branch) while still having only run the proxy check (codextender
    // branch) — or vice versa. The snapshot must make this request's outcome
    // depend ONLY on the value observed at request start.
    let parent: Awaited<ReturnType<typeof makeCodextenderParent>>;
    const { app, store } = await buildApp({
      checkCodextenderProxyAvailable: async () => {
        store.patch(parent.taskId, { codexIntegrationMode: "light" });
        return true;
      },
    });
    parent = await makeCodextenderParent(store);
    const res = await app.request(`/api/external/tasks/${parent.taskId}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { codexIntegrationMode?: string };
      commands: { posix: string };
    };
    // Must still reflect the SNAPSHOT (codextender), not the value the
    // parent was mutated to mid-request (light).
    expect(body.task.codexIntegrationMode).toBe("codextender");
    expect(body.commands.posix).toContain("ANTHROPIC_BASE_URL");
    expect(body.commands.posix).not.toContain("codex ");
  });
});
