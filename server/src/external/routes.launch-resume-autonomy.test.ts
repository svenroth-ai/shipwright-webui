/*
 * routes.launch-resume-autonomy.test.ts
 *  — iterate-2026-08-16-task-lifecycle-ux-fixes (BUG)
 *
 * Bug: `parseLaunchBody`'s `autonomy` field was the ONE launch-body field
 * that did NOT follow the "once-set-always-used" contract (body value ??
 * persisted task value) that `actionId` / `phase` / `phaseLabel` /
 * `description` all already had (see
 * routes.launch-resume-description.test.ts for that sibling fix). Since
 * `useLaunchTask` (both the green "Launch" CTA and every "Resume" click,
 * board or TaskDetail) POSTs only `{ resume }`, every launch past the
 * very first — which came from NewIssueModal and DID send
 * `body.autonomy` explicitly — silently dropped the task's persisted
 * autonomy and rendered `{task.autonomy_flag?}` / the `--autonomous`
 * suffix inside `{task.initial_prompt}` as if the task had never been
 * marked autonomous at all.
 *
 * Fixed in parse-body.ts: `autonomy = bodyAutonomy ?? task.autonomy`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import {
  createExternalRoutes,
  type ExternalRouteProjectView,
} from "./routes.js";
import { clearActionsCache } from "../core/project-actions-loader.js";

function inMemoryStoreDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
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

describe("POST /launch — persisted task autonomy carried into the command", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectPath: string;
  const PROJECT_ID = "project-launch-autonomy";

  function defaultProject(): ExternalRouteProjectView {
    return { id: PROJECT_ID, name: "demo", path: projectPath, profile: "vite-hono" };
  }

  beforeEach(async () => {
    clearActionsCache();
    projectPath = mkdtempSync(path.join(tmpdir(), "launch-autonomy-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryStoreDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: projectPath });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) =>
          id === PROJECT_ID ? defaultProject() : undefined,
        getKnownProjectIds: () => new Set([PROJECT_ID]),
        ptyManager: { get: () => undefined },
      }),
    );
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  async function createTask(): Promise<{ taskId: string }> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "autonomy-task",
        cwd: projectPath,
        projectId: PROJECT_ID,
        actionId: "new-iterate",
      }),
    });
    const json = (await res.json()) as { task: { taskId: string } };
    return json.task;
  }

  async function postLaunch(
    taskId: string,
    body: Record<string, unknown>,
  ): Promise<{
    status: number;
    commands: { powershell: string; cmd: string; posix: string };
  }> {
    const res = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      commands?: { powershell: string; cmd: string; posix: string };
    };
    return {
      status: res.status,
      commands: json.commands ?? { powershell: "", cmd: "", posix: "" },
    };
  }

  it("a Resume click (useLaunchTask sends only { resume }) still carries --autonomous once the FIRST launch set it explicitly", async () => {
    const task = await createTask();

    // NewIssueModal's initial Launch: sends body.autonomy explicitly.
    const first = await postLaunch(task.taskId, {
      resume: false,
      autonomy: "autonomous",
    });
    expect(first.status).toBe(200);
    expect(first.commands.posix).toContain("--autonomous");

    // Every later click — the green Launch CTA on a re-launch, or Resume —
    // goes through useLaunchTask, which sends ONLY `{ resume }`. Pre-fix
    // this silently dropped back to guided.
    const second = await postLaunch(task.taskId, { resume: true });
    expect(second.status).toBe(200);
    expect(second.commands.posix).toContain("--autonomous");
  });

  it("an explicit body.autonomy still overrides the persisted task autonomy", async () => {
    const task = await createTask();
    await postLaunch(task.taskId, { resume: false, autonomy: "autonomous" });

    // A caller explicitly asking for guided wins over the persisted value.
    const { status, commands } = await postLaunch(task.taskId, {
      resume: true,
      autonomy: "guided",
    });
    expect(status).toBe(200);
    expect(commands.posix).not.toContain("--autonomous");
  });

  it("a task that was never marked autonomous stays guided across a bare-body Resume", async () => {
    const task = await createTask();
    await postLaunch(task.taskId, { resume: false });

    const { status, commands } = await postLaunch(task.taskId, { resume: true });
    expect(status).toBe(200);
    expect(commands.posix).not.toContain("--autonomous");
  });
});
