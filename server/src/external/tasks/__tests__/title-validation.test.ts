/*
 * external/tasks/__tests__/title-validation.test.ts — D22 / F27 regression.
 *
 * POST /tasks and POST /tasks/:id/fork historically only TRIMMED the title
 * while PATCH (+ launcher.normalizeTitle) REJECT embedded newlines / empty /
 * over-length. An automated writer (run-config phase title, triage Fix-now
 * seed, leadwright daemon POST) could persist an invalid title; every later
 * Launch/Resume then 500s via the uncaught normalizeTitle throw, and a bad
 * fork left an orphan child row behind.
 *
 * This file locks create + fork to the SAME validation contract PATCH uses
 * (shared `normalizeTitle` helper, identical error strings). The newline +
 * over-length cases are RED on pre-fix `main` (AC2) — pre-fix create/fork
 * persist the invalid title with 200.
 *
 * Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F27.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createTasksRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../../core/session-watcher.js";
import { TITLE_MAX_LENGTH } from "../../_shared/helpers.js";

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

const OVER_LONG = "x".repeat(TITLE_MAX_LENGTH + 1);

async function postCreate(app: Hono, title: unknown): Promise<Response> {
  return app.request("/api/external/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, cwd: "/projects/test" }),
  });
}

async function postFork(
  app: Hono,
  parentId: string,
  title: unknown,
): Promise<Response> {
  return app.request(`/api/external/tasks/${parentId}/fork`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

describe("POST /tasks — title validation parity with PATCH (D22/F27)", () => {
  it("400 'title cannot contain newlines' on embedded newline — not persisted", async () => {
    const { app, store } = await makeApp();
    const res = await postCreate(app, "foo\nbar");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot contain newlines");
    // AC2 — the invalid row must NOT have been persisted.
    expect(store.list()).toHaveLength(0);
  });

  // The rule is /[\r\n]/ — CR, LF, and CRLF must all be rejected, not just
  // LF (a Windows-origin automated writer can carry a bare \r or \r\n).
  it.each([
    ["bare CR", "foo\rbar"],
    ["CRLF", "foo\r\nbar"],
  ])("400 'title cannot contain newlines' on %s — not persisted", async (_label, title) => {
    const { app, store } = await makeApp();
    const res = await postCreate(app, title);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot contain newlines");
    expect(store.list()).toHaveLength(0);
  });

  it("400 'title exceeds N characters' on over-length — not persisted", async () => {
    const { app, store } = await makeApp();
    const res = await postCreate(app, OVER_LONG);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(`title exceeds ${TITLE_MAX_LENGTH} characters`);
    expect(store.list()).toHaveLength(0);
  });

  it("200 a valid title still creates", async () => {
    const { app, store } = await makeApp();
    const res = await postCreate(app, "  Ship it  ");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { title: string } };
    expect(body.task.title).toBe("Ship it");
    expect(store.list()).toHaveLength(1);
  });

  it("200 a blank / whitespace-only title still defaults to 'Untitled task'", async () => {
    const { app } = await makeApp();
    const res = await postCreate(app, "   ");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { title: string } };
    expect(body.task.title).toBe("Untitled task");
  });
});

describe("POST /tasks/:id/fork — title validation parity + no orphan row (D22/F27)", () => {
  it("400 'title cannot contain newlines' on fork — NO child row left", async () => {
    const { app, store } = await makeApp();
    const parent = store.create({ title: "parent", cwd: "/c", pluginDirs: [] });
    const res = await postFork(app, parent.taskId, "foo\nbar");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot contain newlines");
    // AC2 — fork must validate BEFORE creating the child, so only the
    // parent remains (pre-fix code left an orphan child row behind).
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].taskId).toBe(parent.taskId);
  });

  it("400 'title cannot contain newlines' on fork with CRLF — NO child row left", async () => {
    const { app, store } = await makeApp();
    const parent = store.create({ title: "parent", cwd: "/c", pluginDirs: [] });
    const res = await postFork(app, parent.taskId, "foo\r\nbar");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot contain newlines");
    expect(store.list()).toHaveLength(1);
  });

  it("400 'title exceeds N characters' on fork — NO child row left", async () => {
    const { app, store } = await makeApp();
    const parent = store.create({ title: "parent", cwd: "/c", pluginDirs: [] });
    const res = await postFork(app, parent.taskId, OVER_LONG);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(`title exceeds ${TITLE_MAX_LENGTH} characters`);
    expect(store.list()).toHaveLength(1);
  });

  it("200 a valid fork title creates the child + emits launch commands", async () => {
    const { app, store } = await makeApp();
    const parent = store.create({ title: "parent", cwd: "/c", pluginDirs: [] });
    const res = await postFork(app, parent.taskId, "child branch");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { title: string };
      commands: { powershell?: string; bash?: string } | undefined;
    };
    expect(body.task.title).toBe("child branch");
    expect(store.list()).toHaveLength(2);
    // Happy-path non-regression proof (external code review): a valid title
    // flows through buildCopyCommands (normalizeTitle) WITHOUT throwing — the
    // exact path that 500s for an invalid title — so `commands` is emitted.
    expect(body.commands).toBeDefined();
  });

  it("200 a blank fork title still defaults to '<parent> — fork'", async () => {
    const { app, store } = await makeApp();
    const parent = store.create({ title: "parent", cwd: "/c", pluginDirs: [] });
    const res = await postFork(app, parent.taskId, "   ");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { title: string } };
    expect(body.task.title).toBe("parent — fork");
  });
});

describe("PATCH /tasks/:id — shared normalizeTitle helper still enforced", () => {
  it("400 'title cannot contain newlines' on PATCH (helper parity)", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "foo\nbar" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("title cannot contain newlines");
  });

  it("400 'title exceeds N characters' on PATCH (helper parity)", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: OVER_LONG }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(`title exceeds ${TITLE_MAX_LENGTH} characters`);
  });
});
