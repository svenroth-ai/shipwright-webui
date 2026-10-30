/*
 * 108-standalone-view.spec.ts — iterate-2026-10-30-hide-shipwright-views.
 * Real browser: the Settings switch hides Triage in the sidebar, redirects
 * /triage to the board, and survives a reload (per-browser preference).
 */
import { test, expect } from "@playwright/test";

test.describe("Standalone view (iterate-2026-10-30)", () => {
  // @covers FR-01.03
  test("Settings switch hides Triage and redirects its route", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.getByRole("link", { name: /^Triage/ });
    await expect(nav).toBeVisible();

    await page.getByTestId("standalone-view-toggle").check();
    await expect(nav).toHaveCount(0);

    await page.goto("/triage");
    await expect(page).toHaveURL(/\/$/);

    await page.reload();
    await page.goto("/settings");
    await expect(page.getByTestId("standalone-view-toggle")).toBeChecked();
    await expect(page.getByRole("link", { name: /^Triage/ })).toHaveCount(0);

    await page.getByTestId("standalone-view-toggle").uncheck();
    await expect(page.getByRole("link", { name: /^Triage/ })).toBeVisible();
  });
});
