/*
 * Visual baseline — the board. A00 (iterate-2026-07-10), AC1 + AC4.
 *
 * This is the screen the campaign repaints most, and the one vitest is blindest
 * to: a jsdom test happily passes while the board has lost its columns, a glass
 * panel has gone white-on-white, or body text over the backdrop has dropped below
 * AA contrast. Only a pixel diff sees that.
 *
 * Every row on screen is SEEDED here (AC6, provenance honesty): nothing in this
 * baseline is fabricated "live" data, and nothing depends on what the developer
 * happens to have on their machine.
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
import { apiUrl } from "../helpers/env";
import { freezeClock, settle } from "./stabilize";

test.describe("visual: board", () => {
  let project: SeededProject;
  const taskIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    await cleanupProject(request, project);
  });

  test("board", async ({ page, request }) => {
    project = await seedProject(request, { name: "Atlas", dirName: "sw-visual-atlas" });

    // One card per lane, with stable titles — the baseline must encode the
    // COLUMNS, not just "some cards rendered".
    const drafted = await seedTask(request, {
      title: "Draft the rigging plan",
      projectId: project.projectId,
    });
    const second = await seedTask(request, {
      title: "Survey the hull",
      projectId: project.projectId,
    });
    taskIds.push(drafted.taskId, second.taskId);

    // Move one card out of Backlog so more than one lane is populated. The board
    // column is user-owned and decoupled from session state (CLAUDE.md rule 23) —
    // POST /column is the canonical command path. Body key is `column`; the closed
    // set is backlog | in_progress | done (server/src/core/board-column.ts).
    const moved = await request.post(
      apiUrl(`/api/external/tasks/${second.taskId}/column`),
      { data: { column: "in_progress" } },
    );
    expect(moved.ok(), `POST /column -> ${moved.status()}`).toBeTruthy();

    // Anchor the frozen clock on the fixture's own createdAt so the cards'
    // relative-time labels are identical on every run.
    const created = await request
      .get(apiUrl(`/api/external/tasks/${drafted.taskId}`))
      .then((r) => r.json() as Promise<{ task: { createdAt: string } }>);
    await freezeClock(page, created.task.createdAt);
    await setActiveProject(page, project.projectId);

    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId(`task-card-${drafted.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${second.taskId}`)).toBeVisible();
    await settle(page);

    await expect(page).toHaveScreenshot("board.png", { fullPage: true });
  });
});
