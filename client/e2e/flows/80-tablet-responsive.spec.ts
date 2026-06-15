/*
 * Spec 80 — Tablet responsive view (≤1023px).
 * iterate-2026-06-14-tablet-responsive-view, probes P1 / P1b / P3.
 *
 * Verifies, in a real browser at tablet + desktop viewports:
 *   - No horizontal PAGE overflow on the daily-driver routes (P1).
 *   - Sidebar rails across the whole compact band, not just phones (AC-2).
 *   - Board columns become a flush, internally-scrollable swipe carousel at
 *     tablet (justify-start) and keep desktop justify-between at ≥1024px (P3).
 *   - Task detail collapses to the compact PaneTabBar at tablet and keeps the
 *     resizable 3-pane (with visible splitters) on desktop (AC-4).
 *
 * Component-level coverage (PaneTabBar mount-preservation, hook reactivity,
 * sidebar threshold) lives in the vitest specs; this proves the real CSS +
 * router + breakpoints behave at actual viewport sizes.
 */

import { test, expect, type Page } from "@playwright/test";
import { createTask, cleanupTask, makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

const TABLET = { width: 820, height: 1180 }; // iPad portrait — compact band
const DESKTOP = { width: 1280, height: 800 }; // full desktop
const LG_BOUNDARY = { width: 1024, height: 768 }; // exactly lg → desktop

async function pageOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.describe("Tablet responsive — compact (≤1023px)", () => {
  test.use({ viewport: TABLET });

  for (const path of ["/", "/projects", "/inbox", "/triage", "/settings", "/diagnostics"]) {
    test(`no horizontal page overflow at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      // ≤1px tolerance for sub-pixel rounding.
      expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
    });
  }

  test("sidebar rails across the tablet band (expand affordance shown)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toBeVisible();
  });

  test("board fits all three lanes at tablet width — no right cut-off (AC-7)", async ({ page }) => {
    // iterate-2026-06-15 AC-7: the 768–1023px band switched from a 360px-fixed
    // swipe carousel to flexible lanes (basis-0 grow, min-200) so all three
    // lanes are visible at once. justify stays flex-start (lanes grow to fill;
    // justify-between is desktop-only).
    await page.goto("/");
    const cols = page.getByTestId("task-board-columns");
    await expect(cols).toBeVisible();
    expect(await cols.evaluate((el) => getComputedStyle(el).justifyContent)).toBe("flex-start");
    // Lanes now fit — the container does NOT overflow horizontally (≤1px round).
    expect(await cols.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    // …and the page stays un-widened.
    expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
  });

  test("task detail collapses to the compact pane tab bar; terminal pane survives a tab switch", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "tablet-detail-smoke");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("task-detail-page")).toBeVisible();
      await expect(page.getByTestId("pane-tab-bar")).toBeVisible();
      // Resize handles are hidden in compact mode.
      await expect(page.getByTestId("splitter-left")).toBeHidden();
      // All three pane containers stay mounted (forceMount-equivalent).
      await expect(page.getByTestId("pane-left")).toHaveCount(1);
      await expect(page.getByTestId("pane-center")).toHaveCount(1);
      await expect(page.getByTestId("pane-right")).toHaveCount(1);
      // Switch Files → Session: the center (terminal host) is still mounted.
      await page.getByTestId("pane-tab-left").click();
      await page.getByTestId("pane-tab-center").click();
      await expect(page.getByTestId("pane-center")).toHaveCount(1);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("switching compact pane tabs does NOT corrupt the saved desktop pane widths (code-review HIGH)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "tablet-width-guard");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("pane-tab-bar")).toBeVisible();
      const readWidths = () =>
        page.evaluate(() => [
          localStorage.getItem("webui.taskDetail.leftWidth"),
          localStorage.getItem("webui.taskDetail.rightWidth"),
        ]);
      // Compact tab-sizing fires onResize(0/100); the persist path MUST be gated.
      await page.getByTestId("pane-tab-left").click();
      await page.getByTestId("pane-tab-right").click();
      await page.getByTestId("pane-tab-center").click();
      await page.waitForTimeout(400); // > the layout-hook debounce
      // Post-fix the ONLY writer is the layout hook's own default persist
      // (leftWidth 240 / rightWidth 480). Pre-fix, the ungated drag handlers
      // leaked clamped compact values (~180 / ~320) here — which these
      // assertions reject. (null = not-yet-persisted is also acceptable.)
      const [left, right] = await readWidths();
      expect(left === null || left === "240").toBe(true);
      expect(right === null || right === "480").toBe(true);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("list view fits at tablet width (no page overflow; Commit column hidden)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("view-toggle-list").click();
    await expect(page.getByTestId("task-list-header-state")).toBeVisible();
    await expect(page.getByTestId("task-list-header-commit")).toBeHidden();
    expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
  });

  test("sidebar collapse is bidirectional — expand then collapse back to the rail (AC-1)", async ({ page }) => {
    // iterate-2026-06-14-tablet-view-polish AC-1: the reported "Menu kann man
    // nicht collapsen" — once expanded there was no way back to the rail.
    await page.goto("/");
    const aside = page.getByTestId("sidebar-inline");
    const railed = (await aside.boundingBox())!.width; // ~60px rail
    // Expand → a collapse affordance must appear.
    await page.getByRole("button", { name: /expand sidebar/i }).click();
    await expect(page.getByRole("button", { name: /collapse sidebar/i })).toBeVisible();
    await page.waitForTimeout(250); // width transition is 200ms
    const expanded = (await aside.boundingBox())!.width; // ~200px
    expect(expanded).toBeGreaterThan(railed);
    // Collapse back to the rail (the actual bug fix).
    await page.getByRole("button", { name: /collapse sidebar/i }).click();
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toBeVisible();
    await page.waitForTimeout(250);
    expect((await aside.boundingBox())!.width).toBeLessThan(expanded);
  });

  test("all three lanes are visible WITHOUT scrolling at tablet width (AC-7)", async ({ page }) => {
    // iterate-2026-06-15 AC-7 (supersedes the carousel-reveal test): with the
    // flexible-lane layout the Done column is fully in view with no scroll —
    // `ratio: 1` proves each lane is revealed in full, not hard-clipped.
    await page.goto("/");
    await expect(page.getByTestId("column-draft")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("column-in-progress")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("column-done")).toBeInViewport({ ratio: 1 });
  });

  test("projects table drops the Path column at tablet → no in-card horizontal scroll (AC-5)", async ({ page, request }) => {
    // Seed a task so a (synthesized) project row exists for the table to render.
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "tablet-projects-ac5");
    try {
      await page.goto("/projects");
      await expect(page.getByTestId("projects-table")).toBeVisible();
      // The Path header is display:none below lg (hidden lg:table-cell).
      await expect(page.getByRole("columnheader", { name: "Path" })).toBeHidden();
      // The scroll wrapper around the table no longer overflows horizontally.
      const wrapper = page
        .getByTestId("projects-table")
        .locator("xpath=ancestor::*[contains(@style,'overflow')][1]");
      expect(await wrapper.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("list view: Title is the widest column at tablet width (AC-4)", async ({ page }) => {
    // AC-4: the greedy `w-full` Title column must dominate the nowrap content
    // columns at small resolutions (previously crushed by `max-w-0` alone).
    await page.goto("/");
    await page.getByTestId("view-toggle-list").click();
    const title = page.getByTestId("task-list-header-title");
    await expect(title).toBeVisible();
    const t = (await title.boundingBox())!.width;
    const state = (await page.getByTestId("task-list-header-state").boundingBox())!.width;
    const updated = (await page.getByTestId("task-list-header-updated").boundingBox())!.width;
    expect(t).toBeGreaterThan(state);
    expect(t).toBeGreaterThan(updated);
  });
});

test.describe("Terminal survives a breakpoint crossing (P1b — C1 guard)", () => {
  test.use({ viewport: TABLET });

  test("the embedded terminal element is NOT remounted when the viewport crosses 1024px both ways", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "p1b-terminal-survival");
    try {
      await page.goto(`/tasks/${taskId}`);
      // forceMount keeps the terminal in the DOM regardless of the active tab.
      const term = page.getByTestId("embedded-terminal");
      await expect(term).toHaveCount(1);
      const handle = await term.elementHandle();
      // Cross to desktop (3-pane) and back to tablet (compact tabs).
      await page.setViewportSize(DESKTOP);
      await page.waitForTimeout(300);
      await page.setViewportSize(TABLET);
      await page.waitForTimeout(300);
      // Same DOM node ⇒ React never unmounted the subtree ⇒ WS/scrollback intact.
      expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});

test.describe("Desktop non-regression (≥1024px)", () => {
  test.use({ viewport: DESKTOP });

  test("sidebar is expanded (brand label visible)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Shipwright")).toBeVisible();
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
});

test.describe("Breakpoint boundary — 1024px is desktop", () => {
  test.use({ viewport: LG_BOUNDARY });

  test("at exactly 1024px the board uses the desktop layout (justify-between)", async ({ page }) => {
    await page.goto("/");
    const cols = page.getByTestId("task-board-columns");
    await expect(cols).toBeVisible();
    expect(await cols.evaluate((el) => getComputedStyle(el).justifyContent)).toBe("space-between");
  });
});
