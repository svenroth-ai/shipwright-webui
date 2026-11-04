/*
 * readiness-calm-and-empty-state.spec.ts — F0.5 web-surface check
 * (iterate-2026-11-04-empty-state-readiness-calm).
 *   - Codex CLI is only ever an info note on the readiness banner, never an alert row.
 *   - Standalone view hides the Shipwright plugins / plugin cache rows + npx command.
 *   - The empty Projects state and the "Already set up…" line sit on a dark glass ground.
 * @covers FR-01.51
 */
import { test, expect, type Page } from "@playwright/test";

const NOT_READY = {
  ready: false,
  repairCommand: "npx @svenroth-ai/shipwright@latest",
  checks: [
    { key: "claude", label: "Claude CLI", ok: false, detail: "not found", why: "needs one engine", critical: false },
    { key: "codex", label: "Codex CLI", ok: false, detail: "not found", why: "", critical: false, hint: "install codex" },
    { key: "plugins", label: "Shipwright plugins", ok: false, detail: "none installed", why: "no commands", critical: true },
    { key: "cache", label: "Plugin cache", ok: false, detail: "shared/ missing", why: "hooks", critical: true },
    { key: "uv", label: "uv", ok: true, detail: "0.5", why: "", critical: true },
  ],
};

async function mockReadiness(page: Page, standalone: boolean) {
  await page.route("**/api/readiness", (r) => r.fulfill({ json: NOT_READY }));
  if (standalone) {
    await page.addInitScript(() => localStorage.setItem("shipwright:standalone-view", "true"));
  }
}

test.describe("readiness banner calm", () => {
  // @covers FR-01.51
  test("normal view: codex is an info note, plugins stay an alert", async ({ page }) => {
    await mockReadiness(page, false);
    await page.goto("/first-contact");
    await expect(page.getByTestId("readiness-not-ready")).toBeVisible();
    await expect(page.getByTestId("readiness-info-codex")).toBeVisible();
    await expect(page.getByTestId("readiness-missing-codex")).toHaveCount(0);
    await expect(page.getByTestId("readiness-missing-plugins")).toBeVisible();
    await expect(page.getByTestId("wizard-add-existing-line")).toBeVisible();
  });

  // @covers FR-01.51
  test("standalone view: no plugins / cache / npx rows", async ({ page }) => {
    await mockReadiness(page, true);
    await page.goto("/first-contact");
    await expect(page.getByTestId("readiness-not-ready")).toBeVisible();
    await expect(page.getByTestId("readiness-missing-plugins")).toHaveCount(0);
    await expect(page.getByTestId("readiness-missing-cache")).toHaveCount(0);
    await expect(page.getByTestId("readiness-repair-command")).toHaveCount(0);
  });
});

// @covers FR-01.51
test("empty projects state sits on a dark glass panel", async ({ page }) => {
  await page.route("**/api/projects", (r) => r.fulfill({ json: { data: [] } }));
  await page.goto("/projects");
  const empty = page.getByTestId("projects-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toHaveClass(/glass-d/);
});
