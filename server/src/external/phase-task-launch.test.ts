/*
 * phase-task-launch.test.ts — POST /api/external/tasks/:id/launch with the
 * `phaseTaskRef` body shape.
 *
 * Sub-iterate 2 of iterate/multi-session-run-orchestrator-v2.
 *
 * What's covered:
 *   - happy path: command shape (PS / cmd / POSIX) for a real phase_task
 *   - 409 phase_task_not_actionable (status not awaiting_launch)
 *   - 409 phase_task_prereq_not_met
 *   - 409 phase_task_session_uuid_mismatch (shadow mismatch)
 *   - 400 mixed_launch_intents (actionId + phaseTaskRef)
 *   - 400 invalid_phase_task_id (regex)
 *   - create-task idempotency by phaseTaskId
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";
import type { RunConfigReadResult } from "../core/run-config-reader.js";
import type { RunConfigV2 } from "../types/run-config-v2.js";

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "test",
  "fixtures",
  "run-config-v2-sample.json",
);
const FIXTURE: RunConfigV2 = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

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

const PROJECT: ExternalRouteProjectView = {
  id: "p-fixture",
  name: "Fixture Project",
  path: "/projects/fixture",
};

async function makeContext(args: { configReader?: RunConfigReadResult } = {}) {
  const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
  await store.load();
  const watcher = new SessionWatcher({ projectsDir: "/projects" });
  const reader: RunConfigReadResult =
    args.configReader ??
    {
      status: "ok",
      config: FIXTURE,
      diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
    };
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher,
      getKnownProjectIds: () => new Set([PROJECT.id]),
      getProjectById: (id) => (id === PROJECT.id ? PROJECT : undefined),
      readRunConfig: async () => reader,
    }),
  );
  return { app, store };
}

async function createPhaseShadow(
  app: Hono,
  args: { phaseTaskId: string; sessionUuid: string },
) {
  const res = await app.request("/api/external/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "shadow",
      cwd: PROJECT.path,
      projectId: PROJECT.id,
      phaseTaskId: args.phaseTaskId,
      runId: FIXTURE.runId,
      sessionUuid: args.sessionUuid,
      parentRunMaster: false,
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task;
}

describe("POST /api/external/tasks (phase-task linkage)", () => {
  it("accepts phaseTaskId / runId / sessionUuid / parentRunMaster", async () => {
    const { app } = await makeContext();
    const task = await createPhaseShadow(app, {
      phaseTaskId: "ptk-cccc",
      sessionUuid: "33333333-4444-4555-8666-777777777777",
    });
    expect(task.taskId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects malformed phaseTaskId", async () => {
    const { app } = await makeContext();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "shadow",
        cwd: PROJECT.path,
        projectId: PROJECT.id,
        phaseTaskId: "not-a-ptk",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_phase_task_id");
  });

  it("rejects malformed sessionUuid", async () => {
    const { app } = await makeContext();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "shadow",
        cwd: PROJECT.path,
        projectId: PROJECT.id,
        phaseTaskId: "ptk-cccc",
        sessionUuid: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_session_uuid");
  });

  it("rejects malformed runId", async () => {
    const { app } = await makeContext();
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "shadow",
        cwd: PROJECT.path,
        projectId: PROJECT.id,
        phaseTaskId: "ptk-cccc",
        runId: "wrong",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_run_id");
  });

  it("idempotent: a second create with the same phaseTaskId returns the existing shadow", async () => {
    const { app } = await makeContext();
    const t1 = await createPhaseShadow(app, {
      phaseTaskId: "ptk-cccc",
      sessionUuid: "33333333-4444-4555-8666-777777777777",
    });
    // Second POST with the same phaseTaskId.
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "another",
        cwd: PROJECT.path,
        projectId: PROJECT.id,
        phaseTaskId: "ptk-cccc",
        runId: FIXTURE.runId,
        sessionUuid: "33333333-4444-4555-8666-777777777777",
        parentRunMaster: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { taskId: string };
      reused?: boolean;
    };
    expect(body.task.taskId).toBe(t1.taskId);
    expect(body.reused).toBe(true);
  });
});

describe("POST /api/external/tasks/:id/launch (phaseTaskRef)", () => {
  let app: Hono;
  let shadowId: string;

  beforeEach(async () => {
    const ctx = await makeContext();
    app = ctx.app;
    const task = await createPhaseShadow(app, {
      phaseTaskId: "ptk-cccc", // build/01-core, awaiting_launch in fixture
      sessionUuid: "33333333-4444-4555-8666-777777777777",
    });
    shadowId = task.taskId;
  });

  it("happy path: emits the expected command shape with --name + slashCommand", async () => {
    const res = await app.request(`/api/external/tasks/${shadowId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-cccc" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { phaseTaskId?: string; runId?: string; parentRunMaster?: boolean };
      commands: { powershell: string; cmd: string; posix: string };
    };
    expect(body.task.phaseTaskId).toBe("ptk-cccc");
    expect(body.task.runId).toBe(FIXTURE.runId);
    expect(body.task.parentRunMaster).toBe(false);
    expect(body.commands.powershell).toContain(
      "'33333333-4444-4555-8666-777777777777'",
    );
    expect(body.commands.posix).toContain("'/shipwright-build'");
    expect(body.commands.posix).toContain(
      "'Run-a1b2 / build / 01-core'",
    );
  });

  it("400 mixed_launch_intents when actionId + phaseTaskRef are both present", async () => {
    const res = await app.request(`/api/external/tasks/${shadowId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phaseTaskRef: { phaseTaskId: "ptk-cccc" },
        actionId: "new-task",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("mixed_launch_intents");
  });

  it("400 invalid_phase_task_id when the regex fails", async () => {
    const res = await app.request(`/api/external/tasks/${shadowId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "bad" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_phase_task_id");
  });

  it("409 phase_task_not_found", async () => {
    const res = await app.request(`/api/external/tasks/${shadowId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phaseTaskRef: { phaseTaskId: "ptk-9999999" },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("phase_task_not_found");
  });

  it("409 phase_task_not_actionable for a done phase_task", async () => {
    // ptk-9f8e is `done` in the fixture; trying to launch it must 409.
    const ctx = await makeContext();
    const t = await createPhaseShadow(ctx.app, {
      phaseTaskId: "ptk-9f8e",
      sessionUuid: "f7e6d5c4-b3a2-4190-8877-665544332211",
    });
    const res = await ctx.app.request(
      `/api/external/tasks/${t.taskId}/launch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-9f8e" } }),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string };
    expect(body.error).toBe("phase_task_not_actionable");
    expect(body.status).toBe("done");
  });

  it("409 phase_task_prereq_not_met when prerequisites are missing", async () => {
    // Forge a config where ptk-cccc's prereq is NOT in completed_phase_task_ids.
    const cfg: RunConfigV2 = JSON.parse(JSON.stringify(FIXTURE));
    cfg.completed_phase_task_ids = ["ptk-9f8e"]; // missing ptk-bbbb
    const ctx = await makeContext({
      configReader: {
        status: "ok",
        config: cfg,
        diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
      },
    });
    const t = await createPhaseShadow(ctx.app, {
      phaseTaskId: "ptk-cccc",
      sessionUuid: "33333333-4444-4555-8666-777777777777",
    });
    const res = await ctx.app.request(
      `/api/external/tasks/${t.taskId}/launch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-cccc" } }),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("phase_task_prereq_not_met");
  });

  it("409 phase_task_session_uuid_mismatch when shadow's sessionUuid != phase_task's", async () => {
    // Shadow was created with sessionUuid = "33...777" (matches ptk-cccc).
    // Tamper by changing config so ptk-cccc's sessionUuid differs.
    const cfg: RunConfigV2 = JSON.parse(JSON.stringify(FIXTURE));
    const target = cfg.phase_tasks.find((t) => t.phaseTaskId === "ptk-cccc")!;
    target.sessionUuid = "99999999-9999-4999-8999-999999999999";
    const ctx = await makeContext({
      configReader: {
        status: "ok",
        config: cfg,
        diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
      },
    });
    const t = await createPhaseShadow(ctx.app, {
      phaseTaskId: "ptk-cccc",
      sessionUuid: "33333333-4444-4555-8666-777777777777", // OLD uuid
    });
    const res = await ctx.app.request(
      `/api/external/tasks/${t.taskId}/launch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-cccc" } }),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("phase_task_session_uuid_mismatch");
  });

  it("409 run_config_unavailable when the reader reports missing", async () => {
    const ctx = await makeContext({ configReader: { status: "missing" } });
    // Need a shadow but the create-task path also touches getProjectById; OK to use the
    // store directly since we need a task that points at the project.
    const t = await createPhaseShadow(ctx.app, {
      phaseTaskId: "ptk-cccc",
      sessionUuid: "33333333-4444-4555-8666-777777777777",
    });
    const res = await ctx.app.request(
      `/api/external/tasks/${t.taskId}/launch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phaseTaskRef: { phaseTaskId: "ptk-cccc" } }),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string };
    expect(body.error).toBe("run_config_unavailable");
    expect(body.status).toBe("missing");
  });
});
