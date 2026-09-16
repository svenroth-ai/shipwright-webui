/*
 * external/inbox/__tests__/routes.codex.test.ts — Codex Light AC6/§5.3
 * router-level coverage for `codex_watcher`, `codex_approval`, and
 * `codex_error`. Split out of routes.test.ts (that file crossed the
 * 300-line guideline once this section grew) — same convention as the
 * other self-contained sibling test files in this repo.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

import { createInboxRouter } from "../routes.js";
import { clearInboxDeriveCache } from "../_cache.js";
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
    createInboxRouter({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return { app, store };
}

describe("createInboxRouter — GET /api/external/inbox — codex_watcher", () => {
  beforeEach(() => clearInboxDeriveCache());

  it("surfaces a CodexTaskWatcher notice as kind codex_watcher when codexWatcher is wired", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });
    const watcher = new SessionWatcher({ projectsDir: "/projects" });
    const app = new Hono();
    app.route(
      "/",
      createInboxRouter({
        store,
        watcher,
        ptyManager: { get: () => undefined },
        codexWatcher: {
          snapshot: () => [
            { taskId: task.taskId, kind: "nudge_sent", detail: "Sent a nudge.", at: 1000 },
          ],
        },
      }),
    );

    const res = await app.request("/api/external/inbox");
    const body = (await res.json()) as {
      items: { kind: string; taskId: string; noticeKind?: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("codex_watcher");
    expect(body.items[0].taskId).toBe(task.taskId);
    expect(body.items[0].noticeKind).toBe("nudge_sent");
  });

  it("emits no codex_watcher rows when codexWatcher is not wired (legacy/test callers)", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/inbox");
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});

describe("createInboxRouter — GET /api/external/inbox — codex_approval / codex_error (§5.3)", () => {
  beforeEach(() => clearInboxDeriveCache());

  it("surfaces a live approval dialog as kind codex_approval through the real router", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });
    const watcher = new SessionWatcher({ projectsDir: "/projects" });
    const app = new Hono();
    app.route(
      "/",
      createInboxRouter({
        store,
        watcher,
        ptyManager: {
          get: () => undefined,
          peekTerminalText: () => "Allow Codex to run `rm -rf build`?\n1. Yes\n2. No",
        },
      }),
    );

    const res = await app.request("/api/external/inbox");
    const body = (await res.json()) as {
      items: { kind: string; taskId: string; promptText?: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("codex_approval");
    expect(body.items[0].taskId).toBe(task.taskId);
    expect(body.items[0].promptText).toContain("Allow Codex to run");
  });

  it("does not require codexWatcher to be wired for codex_approval to surface", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });
    const watcher = new SessionWatcher({ projectsDir: "/projects" });
    const app = new Hono();
    app.route(
      "/",
      createInboxRouter({
        store,
        watcher,
        ptyManager: {
          get: () => undefined,
          peekTerminalText: () => "turn aborted. Something went wrong? Hit `/feedback` to report the issue.",
        },
        // codexWatcher deliberately omitted
      }),
    );

    const res = await app.request("/api/external/inbox");
    const body = (await res.json()) as { items: { kind: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("codex_error");
  });

  it("a Codex task's terminal is never scanned by the Claude terminal_prompt detector, even when its text also matches that detector's generic footer cues (code-review finding)", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const task = store.create({ title: "Codex task", cwd: "/c", pluginDirs: [], runtime: "codex" });
    const watcher = new SessionWatcher({ projectsDir: "/projects" });
    const app = new Hono();
    // This text satisfies BOTH detectors: extractTerminalPrompt (Claude's
    // generic "enter to select" + "esc to cancel" footer cues) AND
    // extractCodexApprovalPrompt (the "Allow Codex to run" heading).
    // Without the appendTerminalPrompts runtime guard this would surface
    // as two entries for the same task.
    const dualMatchText = [
      "Allow Codex to run `echo hi`?",
      "1. Yes",
      "2. No",
      "Press enter to select, esc to cancel",
    ].join("\n");
    app.route(
      "/",
      createInboxRouter({
        store,
        watcher,
        ptyManager: {
          get: () => undefined,
          peekTerminalText: () => dualMatchText,
        },
      }),
    );

    const res = await app.request("/api/external/inbox");
    const body = (await res.json()) as { items: { kind: string; taskId: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("codex_approval");
    expect(body.items[0].taskId).toBe(task.taskId);
  });
});
