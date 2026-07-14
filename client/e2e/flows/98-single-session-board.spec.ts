/*
 * Flow 98 — single-session pipeline board representation (campaign
 * webui-pipeline-convergence, sub-iterate W3).
 *
 * W3 renders a `single_session` run as a campaign-like card (steady progress bar
 * + phase checklist + ONE Launch/Resume CTA) INSTEAD of the multi-session
 * MasterTaskCard's per-row Continue buttons. This spec proves the board → card
 * chain end-to-end against the REAL dev stack (real Hono `run-config` route +
 * real `run-config-reader` reading a real on-disk `shipwright_run_config.json`),
 * mirroring the W2 endpoint spec (flow 97). Route interception is deliberately
 * NOT used — the "Backend-affects-Frontend" gate wants the real reader → card.
 *
 * Covered:
 *   1. single_session config → the campaign-like SingleSessionRunCard renders
 *      (progress bar + phase checklist + Launch CTA); the MasterTaskCard and its
 *      per-phase Continue button do NOT appear.
 *   2. single_session config → the per-phase "Continue Pipeline" create-menu
 *      entry is absent (the master drives phases — no per-phase Continue).
 *   3. multi_session config → the UNCHANGED MasterTaskCard renders (regression
 *      parity; W3 must not disturb the deprecated path).
 *
 * The full board-button → sessionStorage → embedded-terminal auto-execute
 * cross-surface flow is W4's capstone.
 */

import { seedLocalStorage } from "../helpers/fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_ID = "run-a1b2c3d4";

function runConfig(
  mode: "single_session" | "multi_session",
  status: "in_progress" | "complete" = "in_progress",
): string {
  return JSON.stringify({
    schemaVersion: 2,
    runId: RUN_ID,
    scope: "full_app",
    autonomy: "guided",
    mode,
    deploy_target: "none",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: { securityEnabled: false, splitMode: null, aikidoClientIdPresent: false },
    splits_frozen: [],
    status,
    completed_phase_task_ids: ["ptk-aaaa"],
    phase_tasks: [
      {
        phaseTaskId: "ptk-aaaa",
        phase: "project",
        splitId: null,
        sessionUuid: "11111111-2222-4333-8444-555555555555",
        version: 1,
        status: "done",
        title: "Run-a1b2 / project",
        slashCommand: "/shipwright-project",
        prerequisites: [],
        executionCount: 1,
        createdAt: "2026-07-09T08:00:00.000Z",
      },
      {
        phaseTaskId: "ptk-bbbb",
        phase: "design",
        splitId: null,
        sessionUuid: "22222222-3333-4444-8555-666666666666",
        version: 1,
        status: "in_progress",
        title: "Run-a1b2 / design",
        slashCommand: "/shipwright-design",
        prerequisites: ["ptk-aaaa"],
        executionCount: 1,
        createdAt: "2026-07-09T09:00:00.000Z",
      },
    ],
    created_at: "2026-07-09T08:00:00.000Z",
    updated_at: new Date().toISOString(),
  });
}

async function makeProjectDir(
  mode: "single_session" | "multi_session",
  status: "in_progress" | "complete" = "in_progress",
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "w3-board-e2e-"));
  await fs.writeFile(path.join(dir, "shipwright_run_config.json"), runConfig(mode, status), "utf-8");
  return dir;
}

async function registerProject(request: APIRequestContext, dir: string): Promise<string> {
  const res = await request.post("/api/projects", {
    data: { name: `w3-e2e-${path.basename(dir)}`, path: dir },
  });
  if (!res.ok()) throw new Error(`POST /api/projects: HTTP ${res.status()} — ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** Land on the board with `projectId` pre-selected as the active project. */
async function openBoard(page: Page, projectId: string): Promise<void> {
  await seedLocalStorage(page, { "webui.activeProjectId": projectId });
  await page.goto("/");
  await expect(page.getByTestId("task-board-page")).toBeVisible();
}

test.describe("Flow 98 — single-session board representation (W3)", () => {
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

  async function setup(
    request: APIRequestContext,
    mode: "single_session" | "multi_session",
    status: "in_progress" | "complete" = "in_progress",
  ): Promise<string> {
    const dir = await makeProjectDir(mode, status);
    track(() => fs.rm(dir, { recursive: true, force: true }));
    const projectId = await registerProject(request, dir);
    track(async () => void (await request.delete(`/api/projects/${encodeURIComponent(projectId)}`)));
    return projectId;
  }

  test("single_session → campaign-like SingleSessionRunCard, no MasterTaskCard / Continue", async ({
    page,
    request,
  }) => {
    const projectId = await setup(request, "single_session");
    await openBoard(page, projectId);

    // The pipelines lane + the campaign-like card render.
    await expect(page.getByTestId("task-board-pipelines-lane")).toBeVisible();
    await expect(page.getByTestId(`single-session-run-card-${RUN_ID}`)).toBeVisible();
    // Steady 7-phase bar: project done, design in flight → 1/7 behind the frontier.
    await expect(page.getByTestId(`single-session-progress-${RUN_ID}`)).toHaveText("1/7");
    // Phase checklist shows the real phase_tasks.
    await expect(page.getByTestId("single-session-phase-ptk-aaaa")).toBeVisible();
    await expect(page.getByTestId("single-session-phase-ptk-bbbb")).toBeVisible();
    // The ONE Launch/Resume CTA.
    await expect(page.getByTestId(`master-run-launch-${RUN_ID}`)).toBeVisible();

    // The multi-session MasterTaskCard + its per-phase Continue must NOT appear.
    await expect(page.getByTestId(`master-task-card-${RUN_ID}`)).toHaveCount(0);
    await expect(page.getByTestId("master-card-continue-ptk-bbbb")).toHaveCount(0);
  });

  test("single_session → no per-phase 'Continue Pipeline' create-menu entry", async ({
    page,
    request,
  }) => {
    const projectId = await setup(request, "single_session");
    await openBoard(page, projectId);
    await expect(page.getByTestId(`single-session-run-card-${RUN_ID}`)).toBeVisible();

    await page.getByTestId("create-menu-caret").click();
    await expect(page.getByTestId("create-menu-item-continue-pipeline")).toHaveCount(0);
  });

  test("single_session + terminal (complete) → card renders full bar, but NO Launch/Resume CTA", async ({
    page,
    request,
  }) => {
    const projectId = await setup(request, "single_session", "complete");
    await openBoard(page, projectId);

    await expect(page.getByTestId(`single-session-run-card-${RUN_ID}`)).toBeVisible();
    // A complete run pins the bar to full (7/7).
    await expect(page.getByTestId(`single-session-progress-${RUN_ID}`)).toHaveText("7/7");
    // The single CTA is hidden for a terminal run (user decision).
    await expect(page.getByTestId(`master-run-launch-${RUN_ID}`)).toHaveCount(0);
  });

  test("multi_session → the UNCHANGED MasterTaskCard renders (regression parity)", async ({
    page,
    request,
  }) => {
    const projectId = await setup(request, "multi_session");
    await openBoard(page, projectId);

    await expect(page.getByTestId("task-board-pipelines-lane")).toBeVisible();
    await expect(page.getByTestId(`master-task-card-${RUN_ID}`)).toBeVisible();
    // The single-session card must NOT appear for a multi-session run.
    await expect(page.getByTestId(`single-session-run-card-${RUN_ID}`)).toHaveCount(0);
  });
});
