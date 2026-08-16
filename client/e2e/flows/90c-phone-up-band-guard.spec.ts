/*
 * Spec 90c — Phone up-band guard (≥768px → inline sidebar, not the drawer).
 * iterate-2026-06-14-phone-responsive-view (FR-01.39, L3), split out of
 * 90-phone-responsive.spec.ts by iterate-2026-08-16-phone-spec-split-fix for
 * bloat headroom (same pattern as the 90b split by
 * iterate-2026-08-15-phone-new-project-test-fix).
 *
 * Runs under the `mobile-chromium` Playwright project (Pixel 5 device
 * defaults) alongside 90-phone-responsive.spec.ts and
 * 90b-phone-new-task-touch-safety.spec.ts (see playwright.config.ts
 * testMatch), but overrides the viewport to a tablet/desktop width — this is
 * the one test in the family proving the phone UI does NOT apply above the
 * 768px breakpoint, the inverse of everything those files assert.
 */

import { test, expect } from "@playwright/test";

test.describe("Phone up-band guard (≥768px → inline sidebar, not the drawer)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("at 1024px the inline sidebar renders, no phone top bar/drawer (L3)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("sidebar-inline")).toBeVisible();
    await expect(page.getByTestId("mobile-topbar")).toHaveCount(0);
  });
});
