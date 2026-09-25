/*
 * Runtime badge/bar visibility vs. `codexAvailability`
 * (iterate-2026-09-26-runtime-badge-and-leads-gate).
 *
 * Before this iterate, RuntimeToggle rendered a static "fixed" pill on
 * every task even when `codexAvailability` was "claude_only"/"codex_only"
 * — i.e. even when there was no per-task runtime choice to show a bar for
 * at all. It now renders nothing in that case, on every surface
 * (NewTaskModal, EditTaskModal, and the Settings card's own preview). The
 * Codex Light campaign/pipeline limitation hint that used to repeat on
 * every task's Runtime field moved to Settings, next to the "How a Codex
 * task actually runs" selector, worded as a global note rather than a
 * per-task warning.
 *
 * Component-level Vitest coverage (RuntimeToggle.test.tsx,
 * EditTaskModal.runtime-availability-race.test.tsx,
 * CodexSettingsCard.test.tsx) proves the conditional-render logic in
 * isolation; this spec proves it against a real running stack.
 */
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { test, expect } from "@playwright/test";

let project: SeededProject;
let uiCreatedTaskId: string | undefined;

test.describe("Runtime badge hidden when only one runtime is available", () => {
  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "runtime-availability-badge-gate" });
    await setActiveProject(page, project.projectId);
    uiCreatedTaskId = undefined;

    const put = await request.put(apiUrl("/api/settings"), {
      data: { codexAvailability: "codex_only" },
    });
    expect(put.ok()).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    // Global settings are shared process-wide state — restore to the
    // default "both" so later spec files in the same isolated-stack run
    // don't inherit "codex_only" (same convention as
    // codextender-integration.spec.ts).
    await request.put(apiUrl("/api/settings"), { data: { codexAvailability: "both" } });
    await cleanupTask(request, uiCreatedTaskId);
    await cleanupProject(request, project);
  });

  // @covers FR-01.01
  test("NewTaskModal shows no Runtime field, no hint, and still creates the task on the forced runtime", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    await page.getByTestId("create-menu-primary").click();
    const modal = page.getByTestId("new-issue-modal-new-task");
    await expect(modal).toBeVisible();

    await expect(modal.getByTestId("runtime-toggle")).toHaveCount(0);
    await expect(modal.getByTestId("runtime-toggle-fixed")).toHaveCount(0);
    await expect(modal.getByTestId("runtime-codex-light-hint")).toHaveCount(0);

    const title = `runtime-badge-gate-${Date.now()}`;
    await page.getByTestId("new-issue-title-input").fill(title);
    await page.getByTestId("new-issue-save-btn").click();
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const list = await request.get(apiUrl("/api/external/tasks"));
    const { tasks = [] } = (await list.json()) as {
      tasks?: Array<{ taskId: string; title: string; runtime?: string }>;
    };
    const created = tasks.find((t) => t.title === title);
    expect(created, `seeded task "${title}" not found via GET /api/external/tasks`).toBeTruthy();
    expect(created!.runtime).toBe("codex");
    uiCreatedTaskId = created!.taskId;

    // AC: EditTaskModal on the still-draft task also shows no runtime bar.
    await page.getByTestId(`task-card-menu-${uiCreatedTaskId}`).click();
    await page.getByTestId(`task-card-edit-${uiCreatedTaskId}`).click();
    const editModal = page.getByTestId("edit-task-modal");
    await expect(editModal).toBeVisible();
    await expect(editModal.getByTestId("runtime-toggle")).toHaveCount(0);
    await expect(editModal.getByTestId("runtime-toggle-fixed")).toHaveCount(0);
    await expect(editModal.getByTestId("runtime-codex-light-hint")).toHaveCount(0);
  });

  // @covers FR-01.01
  test("Settings shows the Codex Light limitation note once, instead of on the task", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();

    const hint = page.getByTestId("settings-codex-light-limitation-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(
      "Codex Light doesn't support campaign or multi-phase pipeline launches yet. Use Claude or Codex over Codextender for those.",
    );

    // The Settings card's own "default runtime" toggle preview is also
    // hidden — same RuntimeToggle, same rule.
    await expect(page.getByTestId("runtime-toggle")).toHaveCount(0);
    await expect(page.getByTestId("runtime-toggle-fixed")).toHaveCount(0);
  });
});
