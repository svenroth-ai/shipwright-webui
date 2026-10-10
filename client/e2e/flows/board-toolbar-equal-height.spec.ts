/*
 * Spec — board-toolbar-equal-height (iterate-2026-10-10-triage-paint-toolbar-height).
 * Sven (iPad, 2026-10-10): the Task Board's header controls were not equally
 * tall (project dropdown 38 / Board-List 47 / filter 44 / density 44 on touch).
 * Real-browser geometry — jsdom has no layout engine.
 */
import { test, expect } from "@playwright/test";
import { cleanupTaskCwd, seedTask, type SeededTask } from "../helpers/fixtures";

let task: SeededTask;
test.beforeEach(async ({ request }) => {
  task = await seedTask(request, { title: `toolbar-${Date.now()}` });
});
test.afterEach(async ({ request }) => {
  await cleanupTaskCwd(request, task);
});

const IDS = [
  "project-filter-dropdown",
  "view-toggle-root",
  "board-filter-menu-trigger",
  "density-toggle",
];

// @covers FR-01.38
test("board toolbar controls are exactly equally tall and share one row", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-toggle-root")).toBeVisible({ timeout: 35_000 });
  const wide = (await page.evaluate(() => innerWidth)) >= 768;
  const boxes: { id: string; y: number; h: number }[] = [];
  for (const id of IDS) {
    const loc = page.getByTestId(id).first();
    if (!(await loc.isVisible())) continue; // phone hides some controls
    const b = (await loc.boundingBox())!;
    boxes.push({ id, y: b.y, h: b.height });
  }
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(boxes[0].h, "absolute toolbar control height").toBeCloseTo(touch ? 44 : 32, 0);
  for (const id of ["view-toggle-board", "view-toggle-list"]) {
    const b = await page.getByTestId(id).boundingBox();
    if (touch && b) expect(b.height, `${id} touch target`).toBeGreaterThanOrEqual(44);
  }
  expect(boxes.length, "at least the dropdown and the view toggle render").toBeGreaterThanOrEqual(2);
  for (const b of boxes) {
    expect(b.h, `${b.id} height`).toBeCloseTo(boxes[0].h, 0);
    // A phone stacks the dropdown above the view toggle by design: one row only from tablet up.
    if (wide) expect(b.y, `${b.id} top`).toBeCloseTo(boxes[0].y, 0);
  }
});
