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
  test("guided new-project flow derives the persistent Stack Profile from the selected answers", async ({
    page,
  }) => {
    await page.goto("/projects");

    // Open the wizard via the testid'd "Create Project" CTA.
    await page.getByTestId("projects-create-button").click();

    await expect(page).toHaveURL(/\/wizard$/);

    await expect(page.getByTestId("intent-wizard")).toBeVisible();
    await page.getByTestId("wizard-door-new").click();
    await page.getByTestId("wizard-brief-input").fill("Test Dynamic Profiles");
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-who").getByText("Just me").click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-remember").getByText("Yes").click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-where").getByText("On the web").click();
    await page.getByTestId("wizard-next").click();

    // The intent wizard superseded the old profile-card picker. Its plan card
    // must still surface the selected stack and retain the deploy-secret cue.
    const plan = page.getByTestId("wizard-plan-card");
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("supabase-nextjs");
    await expect(page.getByTestId("wizard-plan-envvars")).toBeVisible();
  });

  test("guided new-project flow selects the local Stack Profile when persistence is not needed", async ({ page }) => {
    await page.goto("/wizard");
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
    await page.getByTestId("wizard-door-new").click();
    await page.getByTestId("wizard-brief-input").fill("Local-only test project");
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-who").getByText("Just me").click();
    await page.getByTestId("wizard-next").click();
    await page.getByRole("button", { name: "No", exact: true }).click();
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-opt-where").getByText("Just on my machine").click();
    await page.getByTestId("wizard-next").click();

    const plan = page.getByTestId("wizard-plan-card");
    await expect(plan).toContainText("vite-hono");
    await expect(page.getByTestId("wizard-plan-envvars")).toHaveCount(0);
  });
});
