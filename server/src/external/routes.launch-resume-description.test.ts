/*
 * routes.launch-resume-description.test.ts
 *  — iterate-2026-05-18-fix-resume-description (BUG)
 *
 * Bug: the persisted task description (the brief / initial prompt) was
 * only injected into the launch command when the caller sent it in the
 * POST /launch request *body*. v0.4.1 made `actionId` / `phase` /
 * `phaseLabel` "once-set-always-used" (body value ?? persisted task
 * value) but the `description` field was left out of that fallback.
 *
 * `useLaunchTask` sends only `{ resume }` — so BOTH the green "Launch"
 * CTA and every "Resume" click reach POST /launch with no
 * `body.description`, and the brief was silently dropped. Only the
 * NewIssueModal create+launch path (which does send `body.description`)
 * carried it — hence "direct launch works, resume doesn't".
 *
 * Two coordinated fixes in POST /launch verified here:
 *   1. `description` falls back to `task.description` when the body
 *      omits it (v0.4.1-parity — once-set-always-used).
 *   2. A "Resume" click on a task whose Claude conversation was never
 *      established (no JSONL observed on disk → nothing to resume) is
 *      routed through the substitution branch — semantically a FRESH
 *      start, so the brief is injected exactly like a direct Launch.
 *      A genuine resume (JSONL on disk) keeps the description-free
 *      `--resume` shape (user decision 2026-05-18: inject only on
 *      fresh starts, never re-inject mid-conversation).
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

describe("POST /launch — persisted task description carried into the command", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectPath: string;
  const PROJECT_ID = "project-launch-desc";
  // No single-quote / control chars so the assertions can match the raw
  // phrase regardless of per-shell quoting.
  const BRIEF = "investigate the failing checkout redirect";

  function defaultProject(): ExternalRouteProjectView {
    return { id: PROJECT_ID, name: "demo", path: projectPath, profile: "vite-hono" };
  }

  beforeEach(async () => {
    clearActionsCache();
    projectPath = mkdtempSync(path.join(tmpdir(), "launch-desc-"));
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

  async function createTask(opts: {
    actionId?: string;
    description?: string;
    phase?: string;
  }): Promise<{ taskId: string; sessionUuid: string; description?: string }> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "desc-task",
        cwd: projectPath,
        projectId: PROJECT_ID,
        ...opts,
      }),
    });
    const json = (await res.json()) as {
      task: { taskId: string; sessionUuid: string; description?: string };
    };
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

  it("Resume on a never-conversed new-plain task injects the persisted description (fresh start)", async () => {
    const task = await createTask({ actionId: "new-plain", description: BRIEF });
    // Sanity: the brief is persisted on the task at create time.
    expect(task.description).toBe(BRIEF);

    // No firstJsonlObservedAt → no Claude conversation exists → a Resume
    // click is semantically a fresh start. useLaunchTask sends only
    // { resume } — no body.description.
    const { status, commands } = await postLaunch(task.taskId, { resume: true });
    expect(status).toBe(200);

    // The persisted brief reaches all three shell forms.
    expect(commands.posix).toContain(BRIEF);
    expect(commands.powershell).toContain(BRIEF);
    expect(commands.cmd).toContain(BRIEF);

    // Fresh start → --session-id launch, not --resume.
    expect(commands.posix).not.toMatch(/--resume\b/);
    expect(commands.posix).toContain("--session-id");
  });

  it("Resume on a task with an established conversation does NOT re-inject the description", async () => {
    const task = await createTask({ actionId: "new-plain", description: BRIEF });
    // Simulate the SessionWatcher having observed the <uuid>.jsonl — a
    // real Claude conversation now exists on disk.
    store.patch(task.taskId, { firstJsonlObservedAt: new Date().toISOString() });

    const { status, commands } = await postLaunch(task.taskId, { resume: true });
    expect(status).toBe(200);

    // Genuine resume → real --resume; the brief is NOT re-injected as a
    // new mid-conversation message.
    expect(commands.posix).toMatch(/--resume\b/);
    expect(commands.posix).not.toContain(BRIEF);
  });

  it("a direct Launch (resume=false, body without description) uses the persisted description", async () => {
    const task = await createTask({ actionId: "new-plain", description: BRIEF });
    // The green "Launch" CTA also goes through useLaunchTask → body
    // carries no description. Pre-fix this dropped the brief too.
    const { status, commands } = await postLaunch(task.taskId, { resume: false });
    expect(status).toBe(200);
    expect(commands.posix).toContain(BRIEF);
  });

  it("an explicit body.description still overrides the persisted task description", async () => {
    const task = await createTask({ actionId: "new-plain", description: BRIEF });
    const override = "launch-time override brief";
    const { status, commands } = await postLaunch(task.taskId, {
      resume: false,
      description: override,
    });
    expect(status).toBe(200);
    expect(commands.posix).toContain(override);
    expect(commands.posix).not.toContain(BRIEF);
  });

  it("a new-task fresh-start Resume carries the persisted description through {task.initial_prompt}", async () => {
    const task = await createTask({
      actionId: "new-task",
      phase: "test",
      description: BRIEF,
    });
    const { status, commands } = await postLaunch(task.taskId, { resume: true });
    expect(status).toBe(200);
    // {task.initial_prompt} builds the slash command + the brief trailer.
    expect(commands.posix).toContain("/shipwright-test");
    expect(commands.posix).toContain(BRIEF);
    expect(commands.posix).not.toMatch(/--resume\b/);
  });

  it("the dryRun copy-command escape hatch never 400s on a required-param phase", async () => {
    // The "Copy Resume command" ⋯-menu item POSTs { resume:true,
    // dryRun:true }. A build-phase task carries a `required` `section`
    // parameter that is NOT persisted on the task — routing the copy
    // through the substitution branch would throw
    // `required_parameter_missing` → 400. A command COPY must never
    // dead-end like that: the escape hatch degrades to the legacy
    // `--resume` shape instead (the `!dryRun` clause on
    // `effectivelyFreshStart`).
    const task = await createTask({
      actionId: "new-task",
      phase: "build",
      description: BRIEF,
    });
    const { status, commands } = await postLaunch(task.taskId, {
      resume: true,
      dryRun: true,
    });
    expect(status).toBe(200);
    // Legacy fallback shape — no substitution, so no required-param gate.
    expect(commands.posix).toMatch(/--resume\b/);
  });
});
