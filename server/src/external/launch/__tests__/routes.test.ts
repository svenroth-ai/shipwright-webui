/*
 * external/launch/__tests__/routes.test.ts — per-router contract for
 * POST /api/external/tasks/:id/launch.
 *
 * The full-fat behavior (substitution path, resume semantics,
 * phaseTaskRef happy path) is covered by routes.test.ts +
 * phase-task-launch.test.ts + routes.launch-*.test.ts. This file locks
 * the standalone sub-router's response-key contract per
 * `_c2_api_baseline.json` — including the two CLAUDE.md rule 13 guards.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import { createLaunchRouter } from "../routes.js";
import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";

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
  const app = new Hono();
  app.route(
    "/",
    createLaunchRouter({
      store,
      ptyManager: { get: () => undefined },
      runConfigReader: async () => ({ status: "missing" }),
    }),
  );
  return { app, store };
}

describe("createLaunchRouter — POST /api/external/tasks/:id/launch", () => {
  it("404 Task not found", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/external/tasks/t-missing/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Task not found");
  });

  it("409 launch_invalid_state when state=done (non-dryRun)", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    store.patch(t.taskId, { state: "done" });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; state: string };
    expect(body.error).toBe("launch_invalid_state");
    expect(body.state).toBe("done");
  });

  it("400 mixed_launch_intents when phaseTaskRef AND actionId present (CLAUDE.md rule 13)", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionId: "new-plain",
        phaseTaskRef: { phaseTaskId: "ptk-1234" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("mixed_launch_intents");
  });

  it("400 invalid_phase_task_id on malformed phaseTaskRef.phaseTaskId", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phaseTaskRef: { phaseTaskId: "not-a-valid-id" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_phase_task_id");
  });

  it("400 invalid_parameters_body when parameters is an array", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parameters: ["foo"] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_parameters_body");
  });

  it("200 legacy fallback returns { task, commands } when no actionId / phaseTaskRef", async () => {
    const { app, store } = await makeApp();
    const t = store.create({ title: "t", cwd: "/c", pluginDirs: [] });
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { taskId: string };
      commands: { powershell: string; cmd: string; posix: string };
    };
    expect(body.task.taskId).toBe(t.taskId);
    expect(typeof body.commands.powershell).toBe("string");
    expect(typeof body.commands.cmd).toBe("string");
    expect(typeof body.commands.posix).toBe("string");
  });

  // CLAUDE.md rule 13 — load-bearing server-side guard. The shadow task's
  // sessionUuid (set at create-time) MUST match the run-config's
  // phase_task.sessionUuid. Mismatch = tampered store OR stale shadow
  // trying to launch the wrong phase → 409.
  it("409 phase_task_session_uuid_mismatch when shadow uuid ≠ run-config uuid (rule 13)", async () => {
    const store = new SdkSessionsStore(
      "/store/sdk-sessions.json",
      inMemoryDeps(),
    );
    await store.load();
    const t = store.create({
      title: "t",
      cwd: "/c",
      pluginDirs: [],
      projectId: "p-1",
    });
    // Wire a run-config reader that returns an awaiting_launch phase_task
    // bound to a DIFFERENT sessionUuid than the task's persisted one.
    const otherUuid = "00000000-0000-0000-0000-deadbeef1234";
    const app = new Hono();
    app.route(
      "/",
      createLaunchRouter({
        store,
        ptyManager: { get: () => undefined },
        getProjectById: (id) =>
          id === "p-1"
            ? { id: "p-1", name: "p1", path: "/projects/p1" }
            : undefined,
        runConfigReader: async () =>
          ({
            status: "ok",
            config: {
              schemaVersion: 2,
              runId: "run-deadbeef",
              phase_tasks: [
                {
                  phaseTaskId: "ptk-abcd",
                  phase: "build",
                  splitId: null,
                  sessionUuid: otherUuid,
                  status: "awaiting_launch",
                  prerequisites: [],
                  slashCommand: "/shipwright-build",
                },
              ],
              completed_phase_task_ids: [],
            },
            diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
          }) as never,
      }),
    );
    const res = await app.request(`/api/external/tasks/${t.taskId}/launch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phaseTaskRef: { phaseTaskId: "ptk-abcd" },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      taskSessionUuid: string;
      phaseTaskSessionUuid: string;
    };
    expect(body.error).toBe("phase_task_session_uuid_mismatch");
    expect(body.phaseTaskSessionUuid).toBe(otherUuid);
    expect(body.taskSessionUuid).toBe(t.sessionUuid);
  });
});
