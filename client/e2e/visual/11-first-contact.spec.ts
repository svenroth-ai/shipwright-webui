/*
 * Visual baseline — the First Contact hero (iterate-2026-07-23-first-contact-hero,
 * FR-01.51). The first screen a brand-new user sees: the lighthouse plate + the
 * welcome promise + the three doors. vitest is blind to this — it cannot see the
 * white-on-photo hero copy drop below AA over the scrim, the doors go
 * white-on-white, or the lighthouse plate fail to resolve. Only a pixel diff can.
 *
 * `/first-contact` always renders (independent of the registry), so no project
 * seeding is needed. Readiness is pinned READY so the doors render enabled + the
 * gate banner is absent — the shot is not hostage to the CI runner's toolchain
 * (same discipline as 05-wizard.spec.ts).
 */

import { test, expect } from "@playwright/test";
import { settle } from "./stabilize";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    { key: "claude", label: "Claude CLI", ok: true, detail: "2.1.9", why: "", critical: true },
    { key: "plugins", label: "Shipwright plugins", ok: true, detail: "8 installed", why: "", critical: true },
    { key: "cache", label: "Plugin cache", ok: true, detail: "shared/ present", why: "", critical: true },
    { key: "uv", label: "uv", ok: true, detail: "0.5.11", why: "", critical: true },
    { key: "python", label: "Python", ok: true, detail: "3.13 (python3)", why: "", critical: true },
    { key: "git", label: "git", ok: true, detail: "2.47", why: "", critical: true },
  ],
};

test.describe("visual: first contact", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/readiness", (route) => route.fulfill({ json: READY }));
  });

  // @covers FR-01.51
  test("first-contact", async ({ page }) => {
    await page.goto("/first-contact");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Say what you want.", {
      timeout: 15_000,
    });
    // All three doors present + the lighthouse plate resolved before the shot.
    await expect(page.getByTestId("wizard-door-new")).toBeVisible();
    await expect(page.getByTestId("wizard-door-grade")).toBeVisible();
    await expect(page.locator(".scene-bg > img")).toHaveAttribute(
      "src",
      "/backdrops/lighthouse.jpg",
    );
    await settle(page);
    await expect(page).toHaveScreenshot("first-contact.png", { fullPage: true });
  });
});
