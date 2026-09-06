/*
 * external/launch/__tests__/action-substitution-branch.claim-permission.test.ts
 * — FR-04.22 (iterate-2026-09-06-claim-launch-permission-perimeter),
 * Stage-1 spec review follow-up.
 *
 * Reproduces leadwright's REAL contract end to end through the real route:
 * a task created with `actionId` persisted (leadwright's `CreateExternalTaskBody
 * .actionId` is a required field — `webui-client.ts`), then launched with a
 * body carrying ONLY `{ claimToken }` (`webui-launch-client.ts`). Proves the
 * action-substitution branch — not the legacy fallback — is what actually
 * fires here, and that it carries the permission perimeter.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { clearActionsCacheForProject } from "../../../core/project-actions-loader.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

async function makeApp(): Promise<{ app: Hono; store: SdkSessionsStore }> {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const app = new Hono();
  app.route(
    "/",
    createLaunchRouter({
      store,
      ptyManager: { get: () => undefined },
      runConfigReader: async () => ({ status: "missing" }),
      // No project-local .shipwright-webui/actions.json at this path — falls
      // back to the bundled config/default-actions.json (contains "new-plain").
      getProjectById: (id) =>
        id === "p-1" ? { id: "p-1", name: "p1", path: "/nonexistent/project" } : undefined,
    }),
  );
  return { app, store };
}

describe("action-substitution branch — FR-04.22 permission perimeter (real leadwright contract)", () => {
  it("a claim-authorized launch on a task with a PERSISTED actionId (leadwright's real shape) is armed", async () => {
    const { app, store } = await makeApp();
    const t = store.create({
      title: "lead task",
      cwd: "/repo",
      pluginDirs: ["/plugin-a"],
      projectId: "p-1",
      // Leadwright's CreateExternalTaskBody.actionId is required and gets
      // persisted here — the exact shape the Stage-1 review demanded a test
      // for, instead of the "actionId absent" shape the first pass tested.
      actionId: "new-plain",
    });
    store.patch(t.taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await store.persist();

    // Leadwright's own webui-launch-client.ts body: { claimToken } only.
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimToken: "tok-daemon" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commands: { posix: string; cmd: string; powershell: string } };

    // Proves the ARMED branch fired, not an unarmed legacy fallback: the
    // "new-plain" template's own {task.description?} placeholder is absent
    // here (no description set), which is a legacy-fallback command never
    // has in the first place — so this also confirms substitution, not
    // buildCopyCommands, produced the string.
    expect(body.commands.posix).toContain("--plugin-dir");
    expect(body.commands.posix).toMatch(/--tools\s+'Bash,Read,Write,Edit,Glob,Grep'/);
    expect(body.commands.posix).toMatch(/--permission-mode\s+'dontAsk'/);
    expect(body.commands.cmd).toMatch(/--tools\s+"Bash,Read,Write,Edit,Glob,Grep"/);
  });

  it("the SAME task, launched WITHOUT a claim (a human clicking Launch), is unarmed", async () => {
    const { app, store } = await makeApp();
    const t = store.create({
      title: "lead task",
      cwd: "/repo",
      pluginDirs: ["/plugin-a"],
      projectId: "p-1",
      actionId: "new-plain",
    });

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commands: { posix: string } };
    expect(body.commands.posix).not.toContain("--tools");
    expect(body.commands.posix).not.toContain("--permission-mode");
  });
});

describe("action-substitution branch — FR-04.22 fails closed on an un-armable custom template", () => {
  const projectDirs: string[] = [];
  afterEach(() => {
    for (const dir of projectDirs.splice(0)) {
      clearActionsCacheForProject(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeCustomActions(projectDir: string, commandTemplate: string): void {
    mkdirSync(join(projectDir, ".shipwright-webui"), { recursive: true });
    writeFileSync(
      join(projectDir, ".shipwright-webui", "actions.json"),
      JSON.stringify({
        schemaVersion: 1,
        defaults: { autonomy: "guided" },
        actions: [
          {
            id: "custom-no-anchor",
            label: "Custom",
            kind: "external_launch",
            command_template: commandTemplate,
          },
        ],
        phases: [],
        preview: { enabled: "auto" },
      }),
    );
  }

  it("a claim-authorized launch against a custom template with no --session-id anchor returns 409", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "shipwright-webui-actions-"));
    projectDirs.push(projectDir);
    // No {task.uuid} placeholder at all — the arming module has nothing to
    // anchor on and must refuse rather than hand back an unrestricted command.
    writeCustomActions(projectDir, "claude --name {task.session_name}");

    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        runConfigReader: async () => ({ status: "missing" }),
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: projectDir } : undefined,
      }),
    );

    const t = store.create({
      title: "lead task",
      cwd: "/repo",
      pluginDirs: [],
      projectId: "p-1",
      actionId: "custom-no-anchor",
    });
    store.patch(t.taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await store.persist();

    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimToken: "tok-daemon" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("claim_launch_permission_perimeter_unavailable");
  });

  it("a template with NO --session-id {task.uuid} placeholder is refused even when a caller-supplied description coincidentally contains the literal anchor text (Stage-3 doubt review)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "shipwright-webui-actions-"));
    projectDirs.push(projectDir);
    // Uses --resume instead of --session-id, so the rendered-output anchor
    // search would otherwise have nothing genuine to find on. The
    // {task.description?} placeholder is rendered from request-supplied
    // content — see the launch body below.
    writeCustomActions(
      projectDir,
      "claude --resume {task.uuid} {task.description?} --name {task.session_name}",
    );

    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        runConfigReader: async () => ({ status: "missing" }),
        getProjectById: (id) =>
          id === "p-1" ? { id: "p-1", name: "p1", path: projectDir } : undefined,
      }),
    );

    const t = store.create({
      title: "lead task",
      cwd: "/repo",
      pluginDirs: [],
      projectId: "p-1",
      actionId: "custom-no-anchor",
    });
    store.patch(t.taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await store.persist();

    // A description crafted to contain the literal '--session-id <this
    // task's own uuid>' text — the exact string the OLD rendered-output-only
    // anchor search would have matched as a unique, "genuine" anchor.
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimToken: "tok-daemon",
        description: `note --session-id ${t.sessionUuid} done`,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("claim_launch_permission_perimeter_unavailable");
  });
});
