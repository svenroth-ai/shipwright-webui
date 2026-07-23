/*
 * First Contact hero — real-browser smoke (iterate-2026-07-23-first-contact-hero,
 * FR-01.51). Proves the click→navigate wiring the unit tests exercise in jsdom,
 * end to end in a running stack:
 *
 *   - /first-contact ALWAYS renders the lighthouse hero + the three doors
 *     (revisitable + testable without wiping the registry) — runs on any stack;
 *   - a door deep-links into the wizard flow (Rule 1: navigate only);
 *   - the EMPTY-registry root ("/") lands on First Contact instead of the board —
 *     gated on SHIPWRIGHT_E2E_EMPTY_REGISTRY, set by the F0.5 isolated-stack
 *     wrapper (a normal dev machine has projects, so "/" is the board there).
 */
import { test, expect } from "@playwright/test";

test.describe("First Contact hero — always reachable at /first-contact", () => {
  test("renders the lighthouse hero, welcome copy, and the three doors", async ({ page }) => {
    await page.goto("/first-contact");
    await expect(page.getByTestId("first-contact")).toBeVisible();
    await expect(page.getByText("Welcome to the Command Center")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Say what you want.");
    await expect(page.getByTestId("wizard-door-new")).toBeVisible();
    await expect(page.getByTestId("wizard-door-adopt")).toBeVisible();
    await expect(page.getByTestId("wizard-door-grade")).toBeVisible();
    // The lighthouse plate, not the deck-golden signature backdrop.
    await expect(page.locator(".scene-bg > img")).toHaveAttribute(
      "src",
      "/backdrops/lighthouse.jpg",
    );
  });

  test("the Build-new door deep-links into the wizard flow", async ({ page }) => {
    await page.goto("/first-contact");
    // The door is inert until readiness proves ready; the fresh-install stack has
    // the plugins installed, so it becomes enabled.
    const door = page.getByTestId("wizard-door-new");
    await expect(door).toBeEnabled();
    await door.click();
    await expect(page).toHaveURL(/\/wizard$/);
    await expect(page.getByTestId("intent-wizard")).toBeVisible();
  });
});

test.describe("First Contact hero — empty-registry root", () => {
  test.skip(
    !process.env.SHIPWRIGHT_E2E_EMPTY_REGISTRY,
    "root → First Contact only holds on an empty-registry stack (F0.5 wrapper sets the sentinel)",
  );

  test('an empty registry makes "/" land on First Contact, not the board', async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("first-contact")).toBeVisible();
    await expect(page.getByText("Welcome to the Command Center")).toBeVisible();
    // The redirect resolves the lighthouse backdrop (not the board's deck-golden).
    await expect(page).toHaveURL(/\/first-contact$/);
    await expect(page.getByTestId("task-board-page")).toHaveCount(0);
  });
});
