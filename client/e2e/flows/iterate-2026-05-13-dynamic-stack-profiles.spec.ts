/*
 * iterate-2026-05-13-dynamic-stack-profiles — Project Wizard stack-profile step
 * regression fence for FR-01.03's new acceptance criterion.
 *
 * What's tested:
 *   AC-1: When the Stack Profile step renders, every profile from the live
 *         bundled snapshot at `server/profiles/` surfaces as a selectable
 *         card (not just supabase-nextjs).
 *   AC-2: The previously-hardcoded array is gone — clicking a non-supabase
 *         card (e.g. vite-hono) updates the selection state.
 *
 * Runs against the live Hono+Vite dev stack on `http://localhost:5173`.
 * Assumes `npm run dev` is already running in both server/ + client/, or
 * lets Playwright start it via `client/playwright.config.ts` webServer.
 */

import { test, expect } from "@playwright/test";

test.describe("iterate-2026-05-13 — dynamic stack-profile rendering (FR-01.03)", () => {
  test("Stack Profile step renders all bundled profiles + Custom sentinel", async ({
    page,
  }) => {
    await page.goto("/projects");

    // Open the wizard via the testid'd "Create Project" CTA.
    await page.getByTestId("projects-create-button").click();

    // Wait for the wizard modal to mount.
    await expect(page.getByTestId("wizard-modal")).toBeVisible();

    // Step 1: fill name + path so we can advance.
    await page.getByPlaceholder("My Awesome App").fill("Test Dynamic Profiles");
    const pathInput = page
      .getByPlaceholder(/Users|home|projects/)
      .first();
    await pathInput.fill("C:/tmp/test-dynamic-profiles");
    await page.getByTestId("wizard-next").click();

    // Step 2: Stack Profile — the new dynamic step.
    await expect(page.getByText(/Stack & Profile/)).toBeVisible();

    // AC-1: all bundled profiles render. Server resolves
    // server/profiles/{supabase-nextjs,vite-hono,python-plugin-monorepo}.json
    // (refreshed in this iterate). Custom is always last.
    await expect(
      page.getByTestId("stack-profile-card-supabase-nextjs"),
    ).toBeVisible();
    await expect(
      page.getByTestId("stack-profile-card-vite-hono"),
    ).toBeVisible();
    await expect(
      page.getByTestId("stack-profile-card-python-plugin-monorepo"),
    ).toBeVisible();
    await expect(page.getByTestId("stack-profile-card-custom")).toBeVisible();

    // AC-2: clicking vite-hono updates selection (border-primary class).
    const viteHonoCard = page.getByTestId("stack-profile-card-vite-hono");
    await viteHonoCard.click();
    await expect(viteHonoCard).toHaveClass(/border-\[var\(--color-primary\)\]/);
  });
});
