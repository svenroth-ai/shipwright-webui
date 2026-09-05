/*
 * Spec 98 — Desktop sidebar collapse/expand, persisted across reload.
 * (iterate-2026-09-05-nav-collapse-and-version-badges)
 *
 * Desktop (≥1024px) previously had NO collapse control at all — the 200px
 * sidebar was permanently expanded. This adds a user-toggleable rail
 * (icons-only when collapsed), default expanded, remembered via
 * localStorage across a reload — independent of the ≤1023px compact band's
 * own viewport-driven, session-only rail (covered by spec 80).
 */

import { test, expect } from "@playwright/test";

const DESKTOP = { width: 1280, height: 800 };
const STORAGE_KEY = "shipwright:sidebar-collapsed";

test.describe("Desktop sidebar collapse — persisted (spec 98)", () => {
  test.use({ viewport: DESKTOP });

  test("defaults to expanded, collapsing shows icons only, and the choice survives a reload", async ({
    page,
  }) => {
    await page.goto("/");

    // Default: expanded, full labels, collapse control present.
    await expect(page.getByTestId("sidebar-brand-logo")).toBeVisible();
    await expect(page.getByText("Task Board")).not.toHaveClass(/sr-only/);
    const collapseBtn = page.getByRole("button", { name: /collapse sidebar/i });
    await expect(collapseBtn).toBeVisible();
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toHaveCount(0);

    // Collapse — icons-only rail, narrower aside. Assert on the width class
    // directly (not a boundingBox() sample) — `transition-[width]
    // duration-200` animates the box, so a bounding-box read taken right
    // after the click can land mid-transition and still show the old width.
    const aside = page.getByTestId("sidebar-inline");
    await expect(aside).toHaveClass(/w-\[224px\]/);
    await collapseBtn.click();
    await expect(page.getByText("Task Board")).toHaveClass(/sr-only/);
    const expandBtn = page.getByRole("button", { name: /expand sidebar/i });
    await expect(expandBtn).toBeVisible();
    await expect(aside).toHaveClass(/w-\[60px\]/);

    // Persisted to localStorage.
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(stored).toBe("true");

    // Reload — the collapsed rail must survive, no viewport change involved.
    // Railed mode swaps the brand logo out for the expand affordance
    // (SidebarNav.tsx's `railed ?` branch), so the logo is absent here.
    await page.reload();
    await expect(page.getByTestId("sidebar-inline")).toHaveClass(/w-\[60px\]/);
    await expect(page.getByText("Task Board")).toHaveClass(/sr-only/);
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toBeVisible();

    // Expand back — clears the rail and updates storage.
    await page.getByRole("button", { name: /expand sidebar/i }).click();
    await expect(page.getByText("Task Board")).not.toHaveClass(/sr-only/);
    const storedAfterExpand = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(storedAfterExpand).toBe("false");
  });
});
