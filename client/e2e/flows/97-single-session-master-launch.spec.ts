/*
 * Flow 97 — single-session master launch endpoint (campaign
 * webui-pipeline-convergence, sub-iterate W2).
 *
 * W2 ships the *mechanism* to launch the `/shipwright-run` master ONCE via the
 * `webui:pending-auto-launch` handoff (no UI yet — the campaign-like card that
 * calls it is W3; the full board → handoff → terminal cross-surface flow is W4's
 * capstone). This spec proves the endpoint end-to-end against the REAL dev stack
 * (real Hono route + real `run-config-reader` reading a real on-disk
 * `shipwright_run_config.json` + real project resolution):
 *
 *   1. Happy path — a `masterRun` launch on a task whose project carries a
 *      `single_session` run_config returns the `/shipwright-run` command
 *      (built SERVER-SIDE; no `--campaign` / `--resume` / phase command leaks).
 *      The server is the sole command author (Architecture rule 1 / guard #19);
 *      the client sends only `{ masterRun: true }`.
 *   2. Mode-guard — a `multi_session` run is rejected
 *      (`400 master_launch_wrong_mode`); `/shipwright-run` is for single-session
 *      only (multi-session uses per-phase Continue).
 *   3. Fail-closed — no readable run_config → `400 master_launch_no_run_config`.
 *   4. Intent isolation — `masterRun` + another launch intent →
 *      `400 mixed_launch_intents`.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runConfig(mode: "single_session" | "multi_session"): string {
  return JSON.stringify({
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    mode,
    deploy_target: "none",
    pipeline: ["project"],
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status: "in_progress",
    completed_phase_task_ids: [],
    phase_tasks: [],
    created_at: "2026-07-09T00:00:00.000Z",
  });
}

/** A temp project dir carrying a run_config of the given mode (or none). */
async function makeProjectDir(mode: "single_session" | "multi_session" | "none"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "w2-master-e2e-"));
  if (mode !== "none") {
    await fs.writeFile(path.join(dir, "shipwright_run_config.json"), runConfig(mode), "utf-8");
  }
  return dir;
}

async function registerProject(request: APIRequestContext, dir: string): Promise<string> {
  const res = await request.post("/api/projects", {
    data: { name: `w2-e2e-${path.basename(dir)}`, path: dir },
  });
  if (!res.ok()) throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function createTask(
  request: APIRequestContext,
  cwd: string,
  projectId: string | undefined,
): Promise<string> {
  const res = await request.post("/api/external/tasks", {
    data: { title: "W2 master-launch endpoint", cwd, ...(projectId ? { projectId } : {}) },
  });
  if (!res.ok()) throw new Error(`POST /api/external/tasks: HTTP ${res.status()} — ${await res.text()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

function launch(request: APIRequestContext, taskId: string, data: Record<string, unknown>) {
  return request.post(`/api/external/tasks/${encodeURIComponent(taskId)}/launch`, { data });
}

test.describe("Flow 97 — single-session master launch endpoint (W2)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  function track(fn: () => Promise<void>) {
    cleanups.push(fn);
  }

  test.afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
  });

  test("single_session run_config → 200 + server-built /shipwright-run (no campaign/resume leak)", async ({
    request,
  }) => {
    const dir = await makeProjectDir("single_session");
    track(() => fs.rm(dir, { recursive: true, force: true }));
    const projectId = await registerProject(request, dir);
    track(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));
    const taskId = await createTask(request, dir, projectId);

    const res = await launch(request, taskId, { masterRun: true, dryRun: true });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { commands: { posix: string; powershell: string } };
    expect(body.commands.posix).toContain("/shipwright-run");
    expect(body.commands.posix).not.toContain("--campaign");
    expect(body.commands.posix).not.toContain("--resume");
    expect(body.commands.posix).not.toContain("/shipwright-project");
  });

  test("multi_session run_config → 400 master_launch_wrong_mode", async ({ request }) => {
    const dir = await makeProjectDir("multi_session");
    track(() => fs.rm(dir, { recursive: true, force: true }));
    const projectId = await registerProject(request, dir);
    track(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));
    const taskId = await createTask(request, dir, projectId);

    const res = await launch(request, taskId, { masterRun: true, dryRun: true });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("master_launch_wrong_mode");
  });

  test("no run_config → fails closed with 400 master_launch_no_run_config (no /shipwright-run)", async ({
    request,
  }) => {
    const dir = await makeProjectDir("none");
    track(() => fs.rm(dir, { recursive: true, force: true }));
    // Unassigned task (no project) — the project can't resolve to a config.
    const taskId = await createTask(request, dir, undefined);
    track(async () => void (await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`)));

    const res = await launch(request, taskId, { masterRun: true, dryRun: true });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("master_launch_no_run_config");
    expect(JSON.stringify(body)).not.toContain("/shipwright-run");
  });

  test("masterRun + another launch intent → 400 mixed_launch_intents", async ({ request }) => {
    const dir = await makeProjectDir("none");
    track(() => fs.rm(dir, { recursive: true, force: true }));
    const taskId = await createTask(request, dir, undefined);
    track(async () => void (await request.delete(`/api/external/tasks/${encodeURIComponent(taskId)}`)));

    const res = await launch(request, taskId, {
      masterRun: true,
      campaignSlug: "2026-06-02-nope",
      dryRun: true,
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("mixed_launch_intents");
  });
});
