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

  // @covers FR-01.51 — no actions.json: only the plain Claude button, no "New" menu.
  test("a project without actions.json offers only plain Claude", async ({ page }) => {
    const act = (id: string) => ({ id, label: id, kind: "external_launch", description: id });
    const actionsBody = (fromUser: boolean, ids: string[]) => ({
      actions: ids.map(act), phases: [], defaults: { autonomy: "guided" },
      preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
      diagnostics: [], fromUser,
    });
    let body = actionsBody(false, ["new-plain", "new-iterate", "new-task"]);
    await page.route("**/api/projects", (r) =>
      r.fulfill({ json: { data: [{ id: "p1", name: "Proj", path: "C:/proj" }] } }));
    await page.route("**/api/external/tasks", (r) => r.fulfill({ json: { tasks: [] } }));
    await page.route("**/api/external/projects/p1/actions", (r) => r.fulfill({ json: body }));
    await page.addInitScript(() => localStorage.setItem("webui.activeProjectId", "p1"));
    await page.goto("/");
    await expect(page.getByTestId("plain-claude-button")).toBeVisible();
    await expect(page.getByTestId("create-menu-split-button")).toHaveCount(0);
    // With the user's own actions.json the configured New button comes back.
    body = actionsBody(true, ["new-plain", "my-custom"]);
    await page.reload();
    await expect(page.getByTestId("create-menu-split-button")).toBeVisible();
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
