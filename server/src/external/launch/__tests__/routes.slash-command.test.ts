/*
 * external/launch/__tests__/routes.slash-command.test.ts —
 * iterate-2026-06-11-custom-action-slash-command consumer-chain guard.
 *
 * Drives the REAL launch route (POST /api/external/tasks/:id/launch) with a
 * CUSTOM action loaded from disk whose template uses {task.initial_prompt}
 * and which declares `slash_command`. Asserts the returned command fuses the
 * slash command + description into ONE shell-quoted positional — the form the
 * Claude CLI's single `[prompt]` argument actually receives (a separate
 * {task.description?} token would be silently dropped).
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { clearActionsCache } from "../../../core/project-actions-loader.js";

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

const CUSTOM_ACTIONS = {
  schemaVersion: 1,
  defaults: { autonomy: "guided" },
  actions: [
    {
      id: "orchestrate",
      label: "Orchestrate",
      kind: "external_launch",
      slash_command: "/content-orchestrator",
      command_template:
        "{cd.prefix}claude --session-id {task.uuid} --name {task.session_name} {plugin.dirs} {task.initial_prompt}",
      modal_fields: ["title", "description"],
    },
    {
      // Misconfigured: uses {task.initial_prompt} but declares NO slash_command.
      // The GET /actions schema gate rejects this at load, but the launch route
      // does not re-validate — so substitution must convert the resulting
      // UnknownActionError into a typed 400, never an unhandled 500.
      id: "broken",
      label: "Broken",
      kind: "external_launch",
      command_template:
        "{cd.prefix}claude --session-id {task.uuid} {plugin.dirs} {task.initial_prompt}",
      modal_fields: ["title", "description"],
    },
  ],
  phases: [{ id: "content", label: "Content" }],
  preview: { enabled: false },
};

const tmpRoots: string[] = [];
afterEach(() => {
  clearActionsCache();
  for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function makeAppWithCustomActions(): Promise<{
  app: Hono;
  store: SdkSessionsStore;
  projectPath: string;
}> {
  const projectPath = mkdtempSync(path.join(tmpdir(), "slash-cmd-"));
  tmpRoots.push(projectPath);
  mkdirSync(path.join(projectPath, ".shipwright-webui"), { recursive: true });
  writeFileSync(
    path.join(projectPath, ".shipwright-webui", "actions.json"),
    JSON.stringify(CUSTOM_ACTIONS),
    "utf-8",
  );
  clearActionsCache();

  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const app = new Hono();
  app.route(
    "/",
    createLaunchRouter({
      store,
      ptyManager: { get: () => undefined },
      getProjectById: (id) =>
        id === "p-content"
          ? { id: "p-content", name: "Content", path: projectPath }
          : undefined,
      runConfigReader: async () => ({ status: "missing" }),
    }),
  );
  return { app, store, projectPath };
}

describe("launch route — custom action slash_command fuses description (consumer chain)", () => {
  it("fuses /content-orchestrator + description into ONE positional (POSIX + PS + cmd)", async () => {
    const { app, store } = await makeAppWithCustomActions();
    const t = store.create({
      title: "Publishing",
      cwd: "/c/content",
      pluginDirs: [],
      projectId: "p-content",
    });

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "orchestrate",
        phase: "content",
        description: "Erstelle einen Artikel",
        dryRun: true,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commands: { powershell: string; cmd: string; posix: string };
    };
    // ONE fused positional — slash command and brief in the same quoted token.
    expect(body.commands.posix).toContain(
      "'/content-orchestrator Erstelle einen Artikel'",
    );
    expect(body.commands.powershell).toContain(
      "'/content-orchestrator Erstelle einen Artikel'",
    );
    expect(body.commands.cmd).toContain(
      `"/content-orchestrator Erstelle einen Artikel"`,
    );
  });

  it("does NOT emit the description as a separate trailing positional (regression)", async () => {
    const { app, store } = await makeAppWithCustomActions();
    const t = store.create({
      title: "Publishing",
      cwd: "/c/content",
      pluginDirs: [],
      projectId: "p-content",
    });

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "orchestrate",
        phase: "content",
        description: "MyBrief",
        dryRun: true,
      }),
    });
    const body = (await res.json()) as {
      commands: { powershell: string; cmd: string; posix: string };
    };
    // The two-positional bug form was `/content-orchestrator 'MyBrief'`
    // (slash command its own token, brief a SEPARATE quoted token). The fused
    // form keeps them in one token. Assert the separate-token form is absent in
    // ALL three shell forms, and the fused token is present in each.
    expect(body.commands.posix).not.toContain("/content-orchestrator 'MyBrief'");
    expect(body.commands.posix).toContain("'/content-orchestrator MyBrief'");
    expect(body.commands.powershell).not.toContain(
      "/content-orchestrator 'MyBrief'",
    );
    expect(body.commands.powershell).toContain(
      "'/content-orchestrator MyBrief'",
    );
    expect(body.commands.cmd).not.toContain(`/content-orchestrator "MyBrief"`);
    expect(body.commands.cmd).toContain(`"/content-orchestrator MyBrief"`);
  });

  it("400 (not 500) when a custom {task.initial_prompt} action has no slash_command", async () => {
    const { app, store } = await makeAppWithCustomActions();
    const t = store.create({
      title: "Publishing",
      cwd: "/c/content",
      pluginDirs: [],
      projectId: "p-content",
    });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "broken",
        phase: "content",
        description: "x",
        dryRun: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe("command_substitution_failed");
    // The clarified diagnostic should point at the slash_command remedy.
    expect(body.detail).toContain("slash_command");
  });
});
