/*
 * Spec 90 — Phone responsive view (<768px, touch).
 * iterate-2026-06-14-phone-responsive-view (FR-01.39).
 *
 * Runs under the `mobile-chromium` Playwright project (Pixel 5: 393px wide,
 * hasTouch + isMobile) — the desktop `chromium` project ignores this file, and
 * this project runs ONLY this file (see playwright.config.ts testMatch). The
 * first test PROVES the harness really is a coarse-pointer phone (plan-review
 * C1) so the later key-bar / drawer assertions can't pass for the wrong reason.
 *
 * Verifies in a real touch browser:
 *   - No horizontal PAGE overflow on the daily-driver routes at phone width.
 *   - The sidebar is an overlay drawer (hamburger opens; nav-tap + Escape
 *     close; full labels) — NOT the inline rail (AC-2).
 *   - The embedded terminal shows the on-screen key bar on touch (AC-3).
 *   - List Phase column hidden + Projects table scrolls in-card (AC-5).
 *   - A modal fits the phone viewport (AC-4).
 *   - Up-band guard: at ≥768px the inline sidebar renders, not the drawer (L3).
 *
 * Component-level coverage (hooks, key mapping, drawer labels, role-gating)
 * lives in the vitest specs; this proves the real CSS + router + breakpoints
 * + touch media behave at an actual phone viewport.
 */

import { test, expect, type Page } from "@playwright/test";
import { createTask, cleanupTask, makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

async function pageOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.describe("Phone responsive (<768px, touch)", () => {
  test("harness IS a coarse-pointer phone viewport (gate proof — plan-review C1)", async ({ page }) => {
    await page.goto("/");
    const gate = await page.evaluate(() => ({
      coarse: window.matchMedia("(pointer: coarse)").matches,
      phone: window.matchMedia("(max-width: 767px)").matches,
    }));
    expect(gate.coarse).toBe(true);
    expect(gate.phone).toBe(true);
  });

  for (const path of ["/", "/projects", "/inbox", "/triage", "/settings", "/diagnostics"]) {
    test(`no horizontal page overflow at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
    });
  }

  test("sidebar is an overlay drawer — hamburger opens; nav-tap + Escape close (AC-2)", async ({ page }) => {
    await page.goto("/");
    // Phone top bar + hamburger; the inline rail/expand sidebar is NOT in the flow.
    await expect(page.getByTestId("mobile-topbar")).toBeVisible();
    await expect(page.getByTestId("sidebar-inline")).toHaveCount(0);
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);

    // Open the drawer — full labels (not the sr-only icon rail).
    await page.getByTestId("mobile-nav-trigger").click();
    await expect(page.getByTestId("mobile-nav-drawer")).toBeVisible();
    const drawer = page.getByTestId("sidebar-drawer-body");
    const projectsLink = drawer.getByRole("link", { name: "Projects" });
    await expect(projectsLink).toBeVisible();
    // AC-6 — the `pointer-coarse:min-h-[44px]` touch target actually compiles
    // and applies on a real touch device (mechanical proof, code-review INFO).
    const minH = await projectsLink.evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
    expect(minH).toBeGreaterThanOrEqual(44);

    // Escape closes (Radix Dialog built-in).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);

    // Nav-tap navigates AND closes the drawer.
    await page.getByTestId("mobile-nav-trigger").click();
    await page.getByTestId("sidebar-drawer-body").getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0);
  });

  test("list view hides the Phase column at phone width; no page overflow (AC-5)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("view-toggle-list").click();
    await expect(page.getByTestId("task-list-header-state")).toBeVisible();
    await expect(page.getByTestId("task-list-header-phase")).toBeHidden();
    expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
  });

  test("projects table does not widen the page (scrolls in-card) (AC-5)", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.locator("main")).toBeVisible();
    expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
  });

  test("embedded terminal shows the on-screen key bar on touch (AC-3)", async ({ page, request }) => {
    const cwd = await makeTaskCwd();
    const taskId = await createTask(request, cwd, "phone-terminal-keys");
    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("task-detail-page")).toBeVisible();
      // Compact detail: open the Session pane, then the inner Terminal tab.
      await page.getByTestId("pane-tab-center").click();
      await page.getByTestId("task-detail-tab-terminal").click();
      await expect(page.getByTestId("terminal-key-bar")).toBeVisible();
      for (const id of ["esc", "tab", "ctrlc", "up", "down", "left", "right", "enter"]) {
        await expect(page.getByTestId(`terminal-key-${id}`)).toBeVisible();
      }
      // The ⌨ summon-keyboard affordance is present too.
      await expect(page.getByTestId("terminal-key-keyboard")).toBeVisible();
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("a modal fits the phone viewport, no page overflow (AC-4)", async ({ page }) => {
    // The Projects "Create Project" wizard is the deterministically-openable
    // modal on an empty isolated stack (the board create-menu needs a project).
    // The 4 task modals share the same fixed + max-w[9x vw] clamp pattern
    // (unit-covered); this proves a real Radix dialog fits at 393px.
    await page.goto("/projects");
    await page.getByTestId("projects-create-button").click();
    const dialog = page.getByTestId("wizard-modal");
    await expect(dialog).toBeVisible();
    expect(await pageOverflowPx(page)).toBeLessThanOrEqual(1);
    const box = await dialog.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeLessThanOrEqual(vw);
  });
});

test.describe("Phone up-band guard (≥768px → inline sidebar, not the drawer)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("at 1024px the inline sidebar renders, no phone top bar/drawer (L3)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar-inline")).toBeVisible();
    await expect(page.getByTestId("mobile-topbar")).toHaveCount(0);
  });
});
