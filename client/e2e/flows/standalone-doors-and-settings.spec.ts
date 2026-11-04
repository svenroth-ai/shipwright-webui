/*
 * standalone-doors-and-settings.spec.ts — F0.5 web-surface check
 * (iterate-2026-11-04-standalone-ui-followups).
 *   - Standalone view: the wizard/welcome screen offers ONLY "Register an existing project".
 *   - Standalone view: Settings has no Stack Profiles card.
 *   - Settings → Codex: "Claude only" hides run-mode + stall-timeout.
 * @covers FR-01.51
 */
import { test, expect } from "@playwright/test";

const READY = {
  ready: true,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [{ key: "claude", label: "Claude CLI", ok: true, detail: "2", why: "", critical: false }],
};

test.describe("standalone view", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/readiness", (r) => r.fulfill({ json: READY }));
    await page.addInitScript(() => localStorage.setItem("shipwright:standalone-view", "true"));
  });

  // @covers FR-01.51
  test("welcome + /wizard offer only the Register card", async ({ page }) => {
    for (const path of ["/first-contact", "/wizard", "/wizard/adopt"]) {
      await page.goto(path);
      await expect(page.getByTestId("wizard-door-register")).toBeVisible();
      await expect(page.getByTestId("wizard-door-new")).toHaveCount(0);
      await expect(page.getByTestId("wizard-door-adopt")).toHaveCount(0);
      await expect(page.getByTestId("wizard-door-grade")).toHaveCount(0);
    }
  });

  // @covers FR-01.51
  test("settings hides Stack Profiles", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("settings-codex")).toBeVisible();
    await expect(page.getByTestId("settings-stack-profiles")).toHaveCount(0);
  });
});

// @covers FR-01.51
test("Claude only hides the Codex run-mode and stall-timeout sections", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("settings-codex-availability-select").selectOption("claude_only");
  await expect(page.getByTestId("settings-codex-integration-mode")).toHaveCount(0);
  await expect(page.getByTestId("settings-codex-stall-timeout")).toHaveCount(0);
  await page.getByTestId("settings-codex-availability-select").selectOption("both");
  await expect(page.getByTestId("settings-codex-stall-timeout")).toBeVisible();
});
