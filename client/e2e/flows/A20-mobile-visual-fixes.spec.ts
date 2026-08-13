/*
 * A20 — Mobile visual fixes (iterate-2026-08-13-mission-mobile-visual).
 *
 * Real-browser proof for the phone-viewport (≤767px) fixes this iterate
 * shipped: the Task Detail header's back-arrow/actions row no longer
 * vertically overlaps the two-line title+status block, the Resume CTA goes
 * icon-only with an accessible name and a 44px touch target, the shared
 * right-edge gutter is unified at the real (verified, not the mockup's
 * guessed 14px) PageHead value, and the Intent Wizard's Flight Plan rail
 * collapses to a summary chip + bottom sheet.
 *
 * All tests set an explicit phone-width `test.use({ viewport })`, overriding
 * the `mobile-chromium` project's Pixel 5 default — these assertions are pure
 * `(max-width: 767px)` matchMedia branches (`useIsPhoneViewport`), not
 * touch/pointer-gated, so a fixed viewport is all they need. Routed through
 * `mobile-chromium` (playwright.config.ts testMatch) rather than the default
 * `chromium` project, matching the `mobile-work-mode`/`90-phone-responsive`
 * pattern already established there.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { cleanupProject, cleanupTaskCwd, seedProject, seedTask, type SeededTask } from "../helpers/fixtures";

const PHONE = { width: 393, height: 851 };
const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");

/** Seeds a minimal JSONL so the task's state machine converges to "active" —
 *  the same technique 38-jsonl-missing-transition.spec.ts uses — so the
 *  header renders its Resume CTA (state idle/active) instead of Launch. */
function seedActiveJsonl(sessionUuid: string) {
  const dir = path.join(PROJECTS_DIR, `e2e-a20-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${sessionUuid}.jsonl`),
    JSON.stringify({ type: "user", sessionId: sessionUuid, message: { content: "hi" } }) + "\n",
    "utf-8",
  );
}

test.describe("Mobile visual fixes — Task Detail header", () => {
  test.use({ viewport: PHONE });
  let task: SeededTask | undefined;
  test.afterEach(async ({ request }) => {
    await cleanupTaskCwd(request, task);
    task = undefined;
  });

  test("back-arrow, title row and actions cluster don't overlap the status-pills row", async ({ page, request }) => {
    task = await seedTask(request, { title: "A20 header overlap" });
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-detail-header")).toBeVisible();

    const topRowBottom = (await page.getByTestId("task-detail-actions").boundingBox())!.y
      + (await page.getByTestId("task-detail-actions").boundingBox())!.height;
    const statusRowTop = (await page.getByTestId("task-detail-mobile-status-row").boundingBox())!.y;
    expect(statusRowTop, "status row must start at/after the actions row ends").toBeGreaterThanOrEqual(topRowBottom - 1);

    // Back-arrow is a real 44px touch target (regression: an earlier pass of
    // this restructure shrank it to 40px — h-10 w-10 — caught in self-review).
    const backBox = (await page.getByTestId("task-detail-back").boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
  });

  test("Resume is icon-only with an accessible name and a 44px touch target", async ({ page, request }) => {
    task = await seedTask(request, { title: "A20 resume icon-only" });
    seedActiveJsonl(task.sessionUuid);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByTestId("task-state-badge")).toHaveText("In progress", { timeout: 5000 });

    const resume = page.getByRole("button", { name: /resume/i });
    await expect(resume).toBeVisible();
    // Icon-only: no visible label text, only the accessible name.
    await expect(resume).toHaveText("");
    const box = (await resume.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("Mobile visual fixes — shared right-edge gutter", () => {
  test.use({ viewport: PHONE });

  test("the phone top-bar slot's right padding matches the real PageHead gutter (32px)", async ({ page, request }) => {
    const project = await seedProject(request, { name: "a20-gutter" });
    try {
      await page.goto("/");
      const slot = page.getByTestId("mobile-topbar-slot");
      await expect(slot).toBeVisible();
      // 32px (Tailwind pr-8), matching the real, measured PageHead/.page-container
      // gutter — NOT the approved mockup's own illustrative "14px", which this
      // iterate's build verified against the real app and found stale (self-review).
      const paddingRight = await slot.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
      expect(paddingRight).toBeCloseTo(32, 0);
    } finally {
      await cleanupProject(request, project);
    }
  });
});

test.describe("Mobile visual fixes — Board toolbar", () => {
  test.use({ viewport: PHONE });

  test("ViewToggle is icon-only and height-matched to Filter/Density; '+New' keeps an 88px floor", async ({ page, request }) => {
    const project = await seedProject(request, { name: "a20-board-toolbar" });
    try {
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();

      const boardBtn = page.getByTestId("view-toggle-board");
      await expect(boardBtn).toHaveText("");
      await expect(boardBtn).toHaveAccessibleName("Board");
      const toggleBox = (await boardBtn.boundingBox())!;
      expect(toggleBox.height).toBeCloseTo(32, 0);

      const create = page.getByTestId("create-menu-cascade-trigger");
      const createBox = (await create.boundingBox())!;
      expect(createBox.width).toBeGreaterThanOrEqual(88);
    } finally {
      await cleanupProject(request, project);
    }
  });
});

test.describe("Mobile visual fixes — Intent Wizard Flight Plan", () => {
  test.use({ viewport: PHONE });

  test("the Flight Plan rail collapses to a summary chip and opens a bottom sheet with a 44px close target", async ({ page }) => {
    await page.goto("/wizard");
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
    await page.getByTestId("wizard-door-new").click();
    await page.getByTestId("wizard-brief-input").fill("A20 flight plan phone check");
    await page.getByTestId("wizard-next").click();

    // Full rail is gone; the collapsed chip stands in for it.
    await expect(page.getByTestId("wizard-flightplan")).toHaveCount(0);
    const chip = page.getByTestId("wizard-flightplan-chip");
    await expect(chip).toBeVisible();
    const chipBox = (await chip.boundingBox())!;
    expect(chipBox.height).toBeGreaterThanOrEqual(44);

    await chip.click();
    const sheet = page.getByTestId("wizard-flightplan-sheet");
    await expect(sheet).toBeVisible();
    const close = page.getByTestId("wizard-flightplan-sheet-close");
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);

    await close.click();
    await expect(sheet).toHaveCount(0);
  });
});
