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
 * pattern already established there. The "Board toolbar" describe block
 * BELOW is the exception — its `pointer-coarse:` touch-target assertions
 * (iterate-2026-09-09-phone-touch-targets-plus-cta) need `mobile-chromium`'s
 * real `hasTouch`/coarse-pointer emulation, not just the narrow viewport.
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

  // Old rule / new rule, and who asked (iterate-2026-09-09-phone-touch-
  // targets-plus-cta): this test used to assert `createBox.width >=88` — the
  // "+ New" labeled-pill floor from iterate-2026-08-13-mission-mobile-visual.
  // Sven asked for the phone trigger to become a bare "+" instead of a
  // labeled pill, so an 88px-wide box is no longer the right shape to assert:
  // a correct icon-only implementation is ~44px wide, and the OLD assertion
  // would now fail a CORRECT implementation. The replacement intent is
  // square, >=44x44 (AAA/HIG touch floor), icon-only (no visible text), with
  // an accessible name that survives the label's removal — proven once per
  // presentation (All-Projects cascade trigger here; the single-project split
  // button's primary half below), matching the brief's acceptance criterion.
  test("ViewToggle is icon-only and height-matched to Filter/Density; the All-Projects '+ New' trigger is a square icon-only 44px button", async ({ page, request }) => {
    const project = await seedProject(request, { name: "a20-board-toolbar" });
    try {
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();

      const boardBtn = page.getByTestId("view-toggle-board");
      await expect(boardBtn).toHaveText("");
      await expect(boardBtn).toHaveAccessibleName("Board");
      const toggleBox = (await boardBtn.boundingBox())!;
      // Was `toBeCloseTo(32, 0)` — iterate-2026-09-09-phone-touch-targets-
      // plus-cta's audit found this below the AAA/HIG 44px floor (WIDTH
      // stays 32px, documented exemption: see ViewToggle.tsx). Height alone
      // is now bumped to the floor via `pointer-coarse:min-h-[44px]`.
      expect(toggleBox.height).toBeGreaterThanOrEqual(44);

      const create = page.getByTestId("create-menu-cascade-trigger");
      await expect(create).toHaveText("");
      await expect(create).toHaveAccessibleName("New — choose a project");
      const createBox = (await create.boundingBox())!;
      expect(createBox.width).toBeGreaterThanOrEqual(44);
      expect(createBox.height).toBeGreaterThanOrEqual(44);
      // Square, not just "big enough" — a wide pill with the label merely
      // hidden would still pass the two assertions above.
      expect(Math.abs(createBox.width - createBox.height)).toBeLessThanOrEqual(2);

      // Row-width safety net for the whole family of pointer-coarse height
      // bumps this iterate added to the toolbar (Filter/Density/ViewToggle/
      // Claim/LeadTag all stay 32px WIDE by design — see ViewToggle.tsx —
      // specifically so this stays true at 393px).
      const overflowX = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="task-board-header"]');
        return bar ? bar.scrollWidth - bar.clientWidth : 0;
      });
      expect(overflowX).toBeLessThanOrEqual(0);
    } finally {
      await cleanupProject(request, project);
    }
  });

  test("the single-project '+ New' split button's primary half is also a square icon-only 44px button, with an accessible name", async ({ page, request }) => {
    const project = await seedProject(request, { name: "a20-split-icon-only", adopted: true });
    try {
      await page.goto(`/?projectId=${encodeURIComponent(project.projectId)}`);
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await expect(page.getByTestId("create-menu-split-button")).toBeVisible();

      const primary = page.getByTestId("create-menu-primary");
      await expect(primary).toHaveText("");
      await expect(primary.getAttribute("aria-label")).resolves.toBeTruthy();
      const primaryBox = (await primary.boundingBox())!;
      expect(primaryBox.width).toBeGreaterThanOrEqual(44);
      expect(primaryBox.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(primaryBox.width - primaryBox.height)).toBeLessThanOrEqual(2);

      // The caret half (opens task/pipeline/iterate) is a SEPARATE touch
      // target and must clear the floor too — it doesn't lose its label (it
      // never had one, only the ChevronDown glyph + aria-label), only its
      // desktop-only 30px width.
      const caret = page.getByTestId("create-menu-caret");
      const caretBox = (await caret.boundingBox())!;
      expect(caretBox.width).toBeGreaterThanOrEqual(44);
      expect(caretBox.height).toBeGreaterThanOrEqual(44);
    } finally {
      await cleanupProject(request, project);
    }
  });

  test("Plain Claude's project-scoped triggers clear the 44px floor on a coarse pointer", async ({ page, request }) => {
    const project = await seedProject(request, { name: "a20-plain-claude-touch", adopted: true });
    try {
      // All-Projects: ProjectPlainPicker (38x38 base size).
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      const plainPicker = page.getByTestId("plain-cascade-trigger");
      const plainPickerBox = (await plainPicker.boundingBox())!;
      expect(plainPickerBox.width).toBeGreaterThanOrEqual(44);
      expect(plainPickerBox.height).toBeGreaterThanOrEqual(44);

      // Single-project scope: PlainClaudeButton (same base size).
      await page.goto(`/?projectId=${encodeURIComponent(project.projectId)}`);
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      const plainButton = page.getByTestId("plain-claude-button");
      const plainButtonBox = (await plainButton.boundingBox())!;
      expect(plainButtonBox.width).toBeGreaterThanOrEqual(44);
      expect(plainButtonBox.height).toBeGreaterThanOrEqual(44);
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
