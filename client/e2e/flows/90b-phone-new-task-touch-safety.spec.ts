/*
 * Spec 90b — Phone new-task modal touch safety (<768px, touch).
 * iterate-2026-06-14-phone-responsive-view (FR-01.39), split out of
 * 90-phone-responsive.spec.ts by iterate-2026-08-15-phone-new-project-test-fix
 * to keep that file under the 300-line bloat budget (it was already at 307
 * lines before this run, with no baseline exception on record).
 *
 * Runs under the `mobile-chromium` Playwright project (Pixel 5: 393px wide,
 * hasTouch + isMobile) alongside 90-phone-responsive.spec.ts (see
 * playwright.config.ts testMatch).
 *
 * Verifies the New Task modal is touch-safe on a phone: inputs stay >=16px
 * (no iOS Safari focus-zoom) and footer buttons are equal-height >=44px
 * touch targets.
 */

import { test, expect } from "@playwright/test";
import { makeTaskCwd, cleanupCwd } from "../helpers/task-fixture";

test.describe("Phone new-task modal touch safety (<768px, touch)", () => {
  test("new-task modal is touch-safe — inputs ≥16px (no iOS focus-zoom) + equal-height ≥44px footer buttons (iterate-2026-06-27)", async ({ page, request }) => {
    // Seed a real project so the create-menu cascade resolves to an action.
    const projectCwd = await makeTaskCwd("phone-touch-e2e-");
    const created = await request.post("/api/projects", {
      data: { name: `phone-touch-${Date.now()}`, path: projectCwd, profile: "default", status: "active" },
    });
    const { data: p } = (await created.json()) as { data: { id: string } };
    try {
      await page.goto("/");
      await expect(page.getByTestId("task-board-page")).toBeVisible();
      await page.getByTestId("create-menu-cascade-trigger").click();
      await page.getByTestId(`create-menu-cascade-project-${p.id}`).press("Enter");
      await page.getByTestId(`create-menu-cascade-action-${p.id}-new-task`).press("Enter");
      await expect(page.getByTestId("new-issue-modal-new-task")).toBeVisible();

      // iOS Safari auto-zooms the page when a focused control computes to
      // <16px. Every text control in the modal must therefore be ≥16px on a
      // phone — otherwise the modal zooms in + clips on the right (the bug).
      for (const id of ["new-issue-title-input", "new-issue-description-input", "new-issue-project-select"]) {
        const fs = await page.getByTestId(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fs, `${id} font-size`).toBeGreaterThanOrEqual(16);
      }

      // Footer buttons are equal-height ≥44px touch targets — Launch must not
      // tower over Save to Backlog on a phone (only Launch had min-h before).
      const hSave = (await page.getByTestId("new-issue-save-btn").boundingBox())!.height;
      const hLaunch = (await page.getByTestId("new-issue-launch-btn").boundingBox())!.height;
      expect(hSave, "save height").toBeGreaterThanOrEqual(44);
      expect(hLaunch, "launch height").toBeGreaterThanOrEqual(44);
      expect(Math.abs(hSave - hLaunch), "buttons equal height").toBeLessThanOrEqual(2);
      await page.keyboard.press("Escape");
    } finally {
      await request.delete(`/api/projects/${p.id}`);
      await cleanupCwd(projectCwd);
    }
  });
});
