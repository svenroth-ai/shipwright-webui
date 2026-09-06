/*
 * Spec 80b — Desktop non-regression + breakpoint boundary (companion to
 * 80-tablet-responsive.spec.ts, split out iterate-2026-09-06-tablet-ipad-
 * ux-pass to keep both files under the bloat ceiling).
 *
 * Verifies, in a real browser at desktop + the exact 1024px boundary:
 *   - Board columns / list view / task detail keep their desktop layout
 *     (P3) — the tablet-view change in 80-tablet-responsive.spec.ts must
 *     not regress ≥1024px.
 *   - A long task title single-line-truncates with a native tooltip instead
 *     of wrapping unbounded (AC-4b), including at exactly 1024px — the
 *     classic iPad/mini landscape width, 1px outside the ≤1023px compact
 *     breakpoint.
 *
 * Both files assert against the SAME breakpoint contract
 * (useIsCompactViewport, COMPACT_MEDIA_QUERY); read together as one
 * scenario document proving the compact/desktop split holds at every angle.
 */

import { test, expect } from "@playwright/test";
import { createTask, cleanupTask, makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

const DESKTOP = { width: 1280, height: 800 }; // full desktop
const LG_BOUNDARY = { width: 1024, height: 768 }; // exactly lg → desktop

// Long enough that, unbounded, it would wrap across many lines at every
// viewport tested below (mirrors the AC-4b live-browser finding: 5 full
// lines before Grade/Tests/Serves even appeared).
const LONG_TITLE =
  "This is a deliberately very long task title used to prove single-line " +
  "truncation instead of unbounded wrapping across the header at tablet " +
  "and desktop widths on the iPad UX pass";
// A generous single-line ceiling. The tablet/phone variant additionally
// carries `min-h-11` (a 44px tap target) which floors a single truncated
// line right at 44px; wrapped across even 2 lines it would clear ~70px.
const SINGLE_LINE_HEIGHT_CEILING = 60;

test.describe("Desktop non-regression (≥1024px)", () => {
  test.use({ viewport: DESKTOP });

  test("sidebar is expanded (brand logo visible)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar-brand-logo")).toBeVisible();
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toHaveCount(0);
  });

  test("board columns keep desktop justify-between (P3)", async ({ page }) => {
    await page.goto("/");
    const cols = page.getByTestId("task-board-columns");
    await expect(cols).toBeVisible();
    expect(await cols.evaluate((el) => getComputedStyle(el).justifyContent)).toBe("space-between");
  });

  test("list view shows the Commit column on desktop (lg:table-cell)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("view-toggle-list").click();
    await expect(page.getByTestId("task-list-header-commit")).toBeVisible();
  });

  test("task detail keeps the resizable 3-pane (visible splitters, no tab bar)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "desktop-detail-smoke");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("task-detail-page")).toBeVisible();
      await expect(page.getByTestId("pane-tab-bar")).toHaveCount(0);
      await expect(page.getByTestId("splitter-left")).toBeVisible();
      await expect(page.getByTestId("splitter-right")).toBeVisible();
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("a long task title single-line-truncates with a native tooltip instead of wrapping (AC-4b)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, LONG_TITLE);
    try {
      await page.goto(`/tasks/${taskId}`);
      const display = page.getByTestId("task-title-display");
      await expect(display).toBeVisible();

      // Single-line box — before AC-4b this wrapped across ~5 lines and ate
      // most of the header's height before the terminal even started.
      const box = (await display.boundingBox())!;
      expect(box.height).toBeLessThan(SINGLE_LINE_HEIGHT_CEILING);
      // Native hover tooltip carries the untruncated title (desktop only —
      // tablet uses the tap-to-expand popover instead).
      await expect(display).toHaveAttribute("title", LONG_TITLE);

      // Desktop click still opens direct inline edit (not a popover).
      await display.click();
      await expect(page.getByTestId("task-title-input-edit")).toHaveValue(LONG_TITLE);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});

test.describe("Breakpoint boundary — 1024px is desktop", () => {
  test.use({ viewport: LG_BOUNDARY });

  test("at exactly 1024px the board uses the desktop layout (justify-between)", async ({ page }) => {
    await page.goto("/");
    const cols = page.getByTestId("task-board-columns");
    await expect(cols).toBeVisible();
    expect(await cols.evaluate((el) => getComputedStyle(el).justifyContent)).toBe("space-between");
  });

  test("a long title single-line-truncates at exactly 1024px — the classic iPad/mini landscape width (AC-4b)", async ({
    page,
    request,
  }) => {
    // Reproduces the AC-4b live-browser finding directly: 1024px sits 1px
    // outside the ≤1023px compact breakpoint (so it gets the DESKTOP title
    // branch), and before the fix that branch had no truncation at all — the
    // title wrapped across ~5 lines before Grade/Tests/Serves even appeared.
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, LONG_TITLE);
    try {
      await page.goto(`/tasks/${taskId}`);
      const display = page.getByTestId("task-title-display");
      await expect(display).toBeVisible();
      const box = (await display.boundingBox())!;
      expect(box.height).toBeLessThan(SINGLE_LINE_HEIGHT_CEILING);
      await expect(display).toHaveAttribute("title", LONG_TITLE);
      // The desktop title branch renders here, not the tablet popover.
      await expect(page.getByTestId("pane-tab-bar")).toHaveCount(0);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
