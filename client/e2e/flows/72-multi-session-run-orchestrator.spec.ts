/*
 * Flow 72 — multi-session run-orchestrator integration.
 *
 * Verifies the v2 run-config UX wiring: when /api/external/projects/:id/
 * run-config returns a healthy v2 config, the Pipelines lane appears with
 * a Master TaskCard, the "+ New ▾" dropdown surfaces a "Continue Pipeline"
 * entry, and the modal pre-populates from the readyToLaunchTasks[].
 *
 * Uses Playwright route interception so the test doesn't depend on a
 * real shipwright_run_config.json file in the UAT project.
 *
 * What's NOT covered here (already in unit tests):
 *   - Reader / store / route validation (server vitest)
 *   - Master TaskCard state branches (failed / complete / stale — vitest)
 *   - Modal radio list semantics for >1 ready task (vitest)
 *   - useContinuePipeline orchestration branches (vitest)
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect, type Route } from "@playwright/test";

// A00 — was a pinned operator UUID; seeded via the real API in beforeEach.
let project: SeededProject;



const HEALTHY_V2_RESPONSE = {
  status: "ok",
  config: {
    schemaVersion: 2,
    runId: "run-a1b2c3d4",
    scope: "full_app",
    autonomy: "guided",
    deploy_target: "jelastic-dev",
    pipeline: ["project", "design", "plan", "build", "test", "changelog", "deploy"],
    runConditions: {
      securityEnabled: false,
      splitMode: "per_split",
      aikidoClientIdPresent: false,
    },
    splits_frozen: ["01-core"],
    status: "in_progress",
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
        createdAt: "2026-04-25T08:00:00.000Z",
      },
      {
        phaseTaskId: "ptk-bbbb",
        phase: "build",
        splitId: "01-core",
        sessionUuid: "22222222-3333-4444-8555-666666666666",
        version: 1,
        status: "awaiting_launch",
        title: "Run-a1b2 / build / 01-core",
        slashCommand: "/shipwright-build",
        prerequisites: ["ptk-aaaa"],
        executionCount: 0,
        createdAt: "2026-04-25T09:00:00.000Z",
      },
    ],
    created_at: "2026-04-25T08:00:00.000Z",
    updated_at: new Date().toISOString(),
  },
  readyToLaunchTasks: [
    {
      phaseTaskId: "ptk-bbbb",
      phase: "build",
      splitId: "01-core",
      sessionUuid: "22222222-3333-4444-8555-666666666666",
      version: 1,
      status: "awaiting_launch",
      title: "Run-a1b2 / build / 01-core",
      slashCommand: "/shipwright-build",
      prerequisites: ["ptk-aaaa"],
      executionCount: 0,
      createdAt: "2026-04-25T09:00:00.000Z",
    },
  ],
  diagnostics: { droppedPhaseTaskIds: [], warnings: [] },
};

async function mockRunConfig(
  route: Route,
  payload: Record<string, unknown>,
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

test.describe("Flow 72 — multi-session run-orchestrator integration", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "72-multi-session-run-orchestrator" });
    await setActiveProject(page, project.projectId);
  });
  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("Pipelines lane + Master TaskCard render when run-config is v2 healthy", async ({
    page,
  }) => {
    await setActiveProject(page, project.projectId);

    await page.route(
      `**/api/external/projects/${project.projectId}/run-config`,
      (route) => mockRunConfig(route, HEALTHY_V2_RESPONSE),
    );

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(
      page.getByTestId("task-board-pipelines-lane"),
    ).toBeVisible();
    await expect(
      page.getByTestId("master-task-card-run-a1b2c3d4"),
    ).toBeVisible();
    // The awaiting_launch row gets a Continue button.
    await expect(
      page.getByTestId("master-card-continue-ptk-bbbb"),
    ).toBeVisible();
  });

  test("Continue Pipeline entry appears in '+ New ▾' and opens the modal", async ({
    page,
  }) => {
    await setActiveProject(page, project.projectId);

    await page.route(
      `**/api/external/projects/${project.projectId}/run-config`,
      (route) => mockRunConfig(route, HEALTHY_V2_RESPONSE),
    );

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // Open the dropdown via the caret.
    await page.getByTestId("create-menu-caret").click();
    const continueItem = page.getByTestId("create-menu-item-continue-pipeline");
    await expect(continueItem).toBeVisible();
    await continueItem.click();

    // Modal renders + pre-selects the single ready task.
    await expect(
      page.getByTestId("continue-pipeline-modal"),
    ).toBeVisible();
    await expect(
      page.getByTestId("continue-pipeline-single-ptk-bbbb"),
    ).toBeVisible();
    const launch = page.getByTestId("continue-pipeline-launch-btn");
    await expect(launch).toBeEnabled();
  });

  test("v1_legacy run-config: no Pipelines lane, no Continue Pipeline entry", async ({
    page,
  }) => {
    await setActiveProject(page, project.projectId);

    await page.route(
      `**/api/external/projects/${project.projectId}/run-config`,
      (route) => mockRunConfig(route, { status: "v1_legacy" }),
    );

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    // Lane absent.
    await expect(
      page.getByTestId("task-board-pipelines-lane"),
    ).toHaveCount(0);
    // Open dropdown — Continue Pipeline must NOT be there.
    await page.getByTestId("create-menu-caret").click();
    await expect(
      page.getByTestId("create-menu-item-continue-pipeline"),
    ).toHaveCount(0);
  });
});
