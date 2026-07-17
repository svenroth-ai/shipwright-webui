/*
 * Visual baseline — the command palette OPEN over the board (A21, FR-01.65).
 *
 * Proves AC2: the palette is GLASS on the Weather-Deck system (the A03 glass
 * tokens, backdrop visible through it), not a flat opaque modal. Opened with
 * the real Ctrl+K chord so the keyboard path is what the screenshot captures.
 *
 * The A21 runner is on Windows, so the PNG is generated + committed by the
 * orchestrator's pinned-container run (routes.ts marks this `baselined`; the
 * PNG lands in the same regen pass as the other A21 routes). Terminal-free and
 * seeded deterministically — the only non-deterministic region is masked.
 */
import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { settle } from "./stabilize";

test.describe("visual: command palette", () => {
  let project: SeededProject;
  let taskId: string;

  test.afterEach(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
    if (project) await cleanupProject(request, project);
  });

  test("palette-open", async ({ page, request }) => {
    project = await seedProject(request, {
      name: "Atlas",
      dirName: "sw-visual-palette-a21",
    });
    const task = await seedTask(request, {
      title: "Add MFA support",
      projectId: project.projectId,
    });
    taskId = task.taskId;

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // Open the palette with the real chord (focus is on the board, not an input).
    await page.locator("body").click();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot("palette-open.png", {
      fullPage: true,
    });
  });
});
