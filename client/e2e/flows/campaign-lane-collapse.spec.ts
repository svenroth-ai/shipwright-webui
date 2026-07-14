import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

/**
 * Campaign lane collapse/expand + layout — F0.5 web E2E
 * (iterate-2026-06-03-campaign-lane-collapse).
 *
 * Isolated single-process stack seeded with ONE fixture project holding THREE
 * campaigns (each with many steps), so the lane is tall when expanded. Verifies:
 *  - cards are collapsed by default (no steps visible) and the kanban is visible
 *  - expanding all three keeps the kanban on-screen (lane is height-capped +
 *    scrolls) — the regression this iterate fixes
 *  - the expanded state persists across a reload
 */

const SLUGS = ["2026-06-03-aaa", "2026-06-03-bbb", "2026-06-03-ccc"];

test.describe("Campaign lane collapse + layout", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "campaign-lane-collapse" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("default-collapsed, kanban stays visible when all expanded, persists on reload", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId("task-board-campaigns-lane")).toBeVisible({ timeout: 15000 });

    const vh = page.viewportSize()!.height;

    // 1) Collapsed by default — no step rows rendered for any campaign.
    for (const slug of SLUGS) {
      await expect(page.getByTestId(`campaign-toggle-${slug}`)).toBeVisible();
    }
    expect(await page.getByTestId(/^campaign-step-/).count()).toBe(0);

    // kanban visible + within the viewport when collapsed
    const draft = page.getByTestId("column-draft");
    await expect(draft).toBeVisible();
    let box = await draft.boundingBox();
    expect(box!.y).toBeLessThan(vh);

    // 2) Expand all three campaigns.
    for (const slug of SLUGS) {
      await page.getByTestId(`campaign-toggle-${slug}`).click();
    }
    // steps now rendered (body visible)
    expect(await page.getByTestId(/^campaign-step-/).count()).toBeGreaterThan(0);

    // 3) Layout fix: the lane is height-capped (<= ~45vh) and the kanban is
    //    STILL within the viewport — not pushed off-screen.
    const scrollBox = await page.getByTestId("task-board-campaigns-scroll").boundingBox();
    expect(scrollBox!.height).toBeLessThanOrEqual(vh * 0.45);
    box = await draft.boundingBox();
    expect(box!.y).toBeLessThan(vh);

    // 4) Persistence: reload — the campaigns stay expanded (steps still shown).
    await page.reload();
    await expect(page.getByTestId("task-board-campaigns-lane")).toBeVisible({ timeout: 15000 });
    expect(await page.getByTestId(/^campaign-step-/).count()).toBeGreaterThan(0);
  });
});
