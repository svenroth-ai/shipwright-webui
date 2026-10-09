/*
 * Spec 55 — TaskDetail 3-pane layout smoke.
 *
 * Minimal happy-path coverage per section 04b:
 *   - Header, folder tree, transcript, smart viewer all render.
 *   - Two splitters are in the DOM with role="separator".
 *   - localStorage round-trip: arrow-key on a splitter persists width.
 *
 * Unit tests (`TaskDetailThreePane.test.tsx`, `useThreePaneLayout.test.ts`)
 * already cover the keyboard / clamp / invalid-JSON edge cases; this
 * spec proves the surface renders inside the real router + real server
 * round-trip.
 */

import {
  cleanupProject,
  cleanupTaskCwd,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
  type SeededTask,
} from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

test.describe("TaskDetail 3-pane layout", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;
  // Tasks need a REAL temp cwd and must be deleted again: a hardcoded `C:/tmp/...`
  // cwd is a dead path on Windows and leaks an unassigned fixture task that the
  // isolated-stack contamination guard then reports after an otherwise green run.
  let task: SeededTask | undefined;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "55-three-pane-layout" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
    task = undefined;
    await cleanupProject(request, project);
  });

  // @covers FR-01.02
  test("header + folder tree + terminal + smart viewer render; splitters are separators", async ({
    page,
    request,
  }) => {
    task = await seedTask(request, { title: "three-pane-smoke", projectId: project.projectId });

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-page")).toBeVisible();
    await expect(page.getByTestId("task-detail-header")).toBeVisible();
    await expect(page.getByTestId("folder-tree")).toBeVisible();
    await expect(page.getByTestId("task-detail-terminal")).toBeVisible();
    await expect(page.getByTestId("task-detail-viewer")).toBeVisible();

    const splitters = page.locator('[data-testid^="splitter-"][role="separator"]');
    await expect(splitters).toHaveCount(2);
  });

  // @covers FR-01.02
  test("keyboard ArrowRight on left splitter persists leftWidth in localStorage", async ({
    page,
    request,
  }) => {
    task = await seedTask(request, { title: "three-pane-persist", projectId: project.projectId });

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("splitter-left")).toBeVisible();
    const splitter = page.getByTestId("splitter-left");
    await splitter.focus();
    await page.keyboard.press("ArrowRight");
    // Debounce is 200 ms on width writes — give it a beat to land.
    await page.waitForFunction(() => {
      const raw = localStorage.getItem("webui.taskDetail.leftWidth");
      return raw !== null && Number(JSON.parse(raw)) > 240;
    }, { timeout: 2000 });
  });
});
