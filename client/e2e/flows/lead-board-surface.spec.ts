import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

/*
 * Lead board surface (FR-04.11, iterate-2026-09-01-lead-board-surface).
 *
 * Medium+ web-surface E2E required by the Phase Matrix on top of the
 * component-level Vitest coverage authored during Build (LeadTagFilter,
 * TaskCardLeadExpander, TaskCard, TaskBoardPage wiring). Covers the four
 * acceptance criteria a real browser can prove that jsdom cannot:
 *   (a) Bot menu + BellDot filter by the three closed-vocabulary prefixes.
 *   (b) the on-card expander opens in place AND the card's own navigation
 *       to TaskDetail still fires on a plain click.
 *   (c) the bot glyph renders next to the project pill for a lead task and
 *       not for an ordinary one.
 */
test.describe("Lead board surface", () => {
  let project: SeededProject;
  const taskIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    project = await seedProject(request, { name: "lead-board-surface" });
  });

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    await cleanupProject(request, project);
  });

  test("Bot menu and BellDot filter by the three lead-tag prefixes", async ({ page, request }) => {
    const originated = await seedTask(request, {
      title: "Lead-originated task",
      projectId: project.projectId,
      tags: ["lead:src-123"],
    });
    const waiting = await seedTask(request, {
      title: "Waiting on PO task",
      projectId: project.projectId,
      tags: ["lead-wait:po-1"],
    });
    const dedup = await seedTask(request, {
      title: "Dedup pending task",
      projectId: project.projectId,
      tags: ["lead-dedup:hash-1"],
    });
    const ordinary = await seedTask(request, {
      title: "Ordinary task",
      projectId: project.projectId,
    });
    taskIds.push(originated.taskId, waiting.taskId, dedup.taskId, ordinary.taskId);

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toBeVisible();

    // Bot menu: filter to `lead:` only.
    const trigger = page.getByTestId("board-lead-filter-menu-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId("board-lead-filter-menu")).toBeVisible();
    await page.getByTestId("board-lead-filter-menu-item-lead").click();
    await expect(page.getByTestId(`task-card-${originated.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${waiting.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-card-${dedup.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId("board-lead-filter-menu-dot")).toBeVisible();

    // Clear via the menu's own "All" row — the menu is ALREADY open (the
    // checkbox item above uses preventDefault to stay open, same convention
    // as BoardStatusFilter), so re-clicking `trigger` here would fight
    // Radix's own dismiss layer. "All" is a plain Item (no preventDefault),
    // so selecting it also closes the menu.
    await page.getByTestId("board-lead-filter-menu-all").click();
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toBeVisible();
    await expect(page.getByTestId("board-lead-filter-menu-dot")).toHaveCount(0);

    // BellDot: shortcut for `lead-wait:` — reads/writes the SAME filter Set
    // as the Bot menu's checkbox, so toggling it raises the menu's own dot.
    const bellDot = page.getByTestId("board-lead-wait-toggle");
    await expect(bellDot).toBeVisible();
    await expect(bellDot).toHaveAttribute("aria-pressed", "false");
    await bellDot.click();
    await expect(bellDot).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`task-card-${waiting.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${originated.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-card-${dedup.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId("board-lead-filter-menu-dot")).toBeVisible();

    // Dedup: filter to `lead-dedup:` via the menu.
    await bellDot.click();
    await trigger.click();
    await page.getByTestId("board-lead-filter-menu-item-lead-dedup").click();
    await expect(page.getByTestId(`task-card-${dedup.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${originated.taskId}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-card-${waiting.taskId}`)).toHaveCount(0);
  });

  test("the card expander opens in place; plain card click still navigates to TaskDetail", async ({
    page,
    request,
  }) => {
    const leadTask = await seedTask(request, {
      title: "Lead task with metadata",
      projectId: project.projectId,
      tags: ["lead:src-456", "lead-wait:po-2"],
    });
    taskIds.push(leadTask.taskId);

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${leadTask.taskId}`)).toBeVisible();

    // (c) bot glyph present for the lead task.
    await expect(page.getByTestId(`task-card-lead-glyph-${leadTask.taskId}`)).toBeVisible();

    // (b) expander opens IN PLACE — no navigation on the toggle click.
    const toggle = page.getByTestId(`task-card-lead-expander-toggle-${leadTask.taskId}`);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId(`task-card-lead-expander-body-${leadTask.taskId}`)).toBeVisible();
    await expect(page).toHaveURL(/\/$|\/board/);

    // Clicking inside the open panel (not the toggle) also does not navigate.
    await page.getByTestId(`task-card-lead-wait-${leadTask.taskId}`).click();
    await expect(page).toHaveURL(/\/$|\/board/);
    await expect(page.getByTestId(`task-card-lead-expander-body-${leadTask.taskId}`)).toBeVisible();

    // A plain click on the card body (outside the expander) still navigates.
    await page.getByTestId(`task-card-${leadTask.taskId}`).click({ position: { x: 10, y: 10 } });
    await expect(page).toHaveURL(new RegExp(`/tasks/${leadTask.taskId}$`));
  });

  test("BellDot filtering to zero matches shows the clear-filters affordance, in both board and list view", async ({
    page,
    request,
  }) => {
    const ordinary = await seedTask(request, {
      title: "Ordinary task, no lead tags",
      projectId: project.projectId,
    });
    taskIds.push(ordinary.taskId);

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toBeVisible();

    // BellDot guarantees zero matches: the only seeded task has no lead tags.
    await page.getByTestId("board-lead-wait-toggle").click();
    await expect(page.getByTestId("task-board-no-filter-matches")).toBeVisible();
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toHaveCount(0);

    // clearAllFilters resets BOTH filters and the card returns.
    await page.getByTestId("task-board-clear-filters").click();
    await expect(page.getByTestId("task-board-no-filter-matches")).toHaveCount(0);
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toBeVisible();
    await expect(page.getByTestId("board-lead-wait-toggle")).toHaveAttribute("aria-pressed", "false");

    // The same branch guards list view — the ternary chain in TaskBoardPage
    // sits ABOVE `view === "list"`, so it must preempt both bodies, not just
    // kanban (code review finding: this ordering was previously untested).
    await page.goto("/?view=list");
    await expect(page.getByTestId("task-list-view")).toBeVisible();
    await page.getByTestId("board-lead-wait-toggle").click();
    await expect(page.getByTestId("task-board-no-filter-matches")).toBeVisible();
    await expect(page.getByTestId("task-list-view")).toHaveCount(0);
    await page.getByTestId("task-board-clear-filters").click();
    await expect(page.getByTestId("task-list-view")).toBeVisible();
    await expect(page.getByTestId(`task-list-row-${ordinary.taskId}`)).toBeVisible();
  });

  test("the bot glyph does not render for an ordinary (non-lead) task", async ({
    page,
    request,
  }) => {
    const ordinary = await seedTask(request, {
      title: "Ordinary task, no lead tags",
      projectId: project.projectId,
    });
    taskIds.push(ordinary.taskId);

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${ordinary.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-lead-glyph-${ordinary.taskId}`)).toHaveCount(0);
    await expect(
      page.getByTestId(`task-card-lead-expander-toggle-${ordinary.taskId}`),
    ).toHaveCount(0);
  });
});
