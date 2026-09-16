/*
 * Spec — Codex runtime toggle end-to-end journey (Codex Light,
 * iterate-2026-09-16-codex-light-webui, F0.5 gate).
 *
 * Proves the RuntimeToggle wiring through the real stack, not just in
 * isolated unit tests:
 *   1. NewTaskModal renders RuntimeToggle defaulting to Claude.
 *   2. Selecting Codex + saving persists `runtime: "codex"` server-side
 *      (POST /api/external/tasks round-trip — the create.ts AC1 path).
 *   3. Re-opening the Edit dialog on the still-draft task shows the same
 *      selection, still editable (pre-launch).
 *
 * A second test proves the launch-time freeze mechanism itself (same
 * component, same `isFieldEditable("runtime")` call — EditTaskModalFields.tsx
 * — that also drives the Codex-specific read-only "Codex" label, already
 * covered by EditTaskModal.runtime-toggle.test.tsx's jsdom test) against a
 * REAL `/launch` round-trip. It deliberately uses a Claude-runtime task:
 * AC8 makes a genuine Codex launch 400 with `codex_cli_not_found` on any
 * machine (including this E2E harness) that doesn't have the Codex CLI on
 * PATH — a real, correct gate, not a thing to route around. Claude launches
 * pass through `applyRuntimeChokepoint` unchanged and need no external CLI.
 */
import {
  cleanupProject,
  cleanupTask,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("Codex runtime toggle — create, persist, edit-dialog reflect", () => {
  let project: SeededProject;
  let seededTask: SeededTask | undefined;
  let uiCreatedTaskId: string | undefined;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "runtime-toggle-codex" });
    await setActiveProject(page, project.projectId);
    seededTask = undefined;
    uiCreatedTaskId = undefined;
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, uiCreatedTaskId);
    await cleanupTaskCwd(request, seededTask);
    await cleanupProject(request, project);
  });

  test("select Codex in NewTaskModal → persists → Edit dialog reflects it (pre-launch) @FR-01.74", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // Open New Task modal.
    await page.getByTestId("create-menu-primary").click();
    const modal = page.getByTestId("new-issue-modal-new-task");
    await expect(modal).toBeVisible();

    // RuntimeToggle renders and defaults to Claude.
    const toggle = modal.getByTestId("runtime-toggle");
    await expect(toggle).toBeVisible();
    await expect(modal.getByTestId("runtime-claude")).toHaveAttribute("aria-checked", "true");
    await expect(modal.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "false");

    // Select Codex.
    await modal.getByTestId("runtime-codex").click();
    await expect(modal.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "true");
    await expect(modal.getByTestId("runtime-claude")).toHaveAttribute("aria-checked", "false");

    const title = `runtime-codex-${Date.now()}`;
    await page.getByTestId("new-issue-title-input").fill(title);
    await page.getByTestId("new-issue-save-btn").click();

    // Modal closes; task lands in Backlog.
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    const draft = page.getByTestId("column-draft");
    await expect(draft).toContainText(title);

    // API readback — the create path genuinely persisted runtime: "codex".
    const list = await request.get("/api/external/tasks");
    const { tasks = [] } = (await list.json()) as {
      tasks?: Array<{ taskId: string; title: string; runtime?: string }>;
    };
    const created = tasks.find((t) => t.title === title);
    expect(created, `seeded task "${title}" not found via GET /api/external/tasks`).toBeTruthy();
    expect(created!.runtime).toBe("codex");
    const taskId = created!.taskId;
    uiCreatedTaskId = taskId;

    // Re-open via the board card's ⋯ menu → Edit task. Still pre-launch:
    // the toggle is editable and shows Codex selected.
    await page.getByTestId(`task-card-menu-${taskId}`).click();
    await page.getByTestId(`task-card-edit-${taskId}`).click();
    const editModal = page.getByTestId("edit-task-modal");
    await expect(editModal).toBeVisible();
    await expect(editModal.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(editModal).toHaveCount(0);
  });

  test("runtime field freezes read-only in the Edit dialog after a real /launch round-trip @FR-01.74", async ({
    page,
    request,
  }) => {
    const task = await seedTask(request, { title: "runtime-freeze-e2e", projectId: project.projectId });
    const launch = await request.post(`/api/external/tasks/${task.taskId}/launch`, { data: {} });
    expect(launch.ok(), `launch failed: ${await launch.text()}`).toBeTruthy();

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await page.getByTestId("task-detail-menu-trigger").click();
    await page.getByTestId("task-detail-menu-edit-task").click();
    await expect(page.getByTestId("edit-task-modal")).toBeVisible();

    // Field is now frozen — read-only "Claude" label, no toggle. The same
    // isFieldEditable("runtime") gate and readonlyValue() branch render
    // "Codex" instead when the seeded task's runtime is codex (jsdom-proven
    // in EditTaskModal.runtime-toggle.test.tsx); this leg proves the real
    // `/launch` route genuinely flips the task out of "never started" in a
    // live browser, which the jsdom test cannot.
    await expect(page.getByTestId("edit-task-readonly-runtime")).toHaveText("Claude");
    await expect(page.getByTestId("runtime-toggle")).toHaveCount(0);
  });
});
