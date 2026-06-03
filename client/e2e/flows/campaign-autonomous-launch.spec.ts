import { test, expect } from "@playwright/test";

/**
 * Campaign autonomous launch — F0.5 web-surface E2E (FR-01.34).
 *
 * Driven against an isolated single-process stack (built worktree client served
 * by the worktree Hono via SHIPWRIGHT_STATIC_DIR, temp USERPROFILE, local
 * network profile) seeded with ONE fixture project whose
 * `.shipwright/planning/iterate/campaigns/2026-06-03-autolaunch-demo/` holds a
 * 2-step ACTIVE campaign (B0 complete / B1 pending, not risky). That is the only
 * real project, so the board selects it on load and the lane renders.
 *
 * Proves the second lane action end-to-end: expand → "Launch autonomous" →
 * confirm dialog shows the exact `/shipwright-iterate --campaign <slug>
 * --autonomous` command + the no-gate warning → Confirm creates a task via the
 * REAL server campaign launch branch and navigates to its TaskDetail (AC-7/AC-9).
 */

const SLUG = "2026-06-03-autolaunch-demo";

test.describe("Campaign autonomous launch from the board", () => {
  test("expand → Launch autonomous → confirm → navigates to a TaskDetail", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const lane = page.getByTestId("task-board-campaigns-lane");
    await expect(lane).toBeVisible({ timeout: 15000 });

    // Cards are collapsed by default — expand to reveal the launch row.
    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible();
    await page.getByTestId(`campaign-toggle-${SLUG}`).click();

    // The second action — enabled because B1 is pending.
    const launchBtn = page.getByTestId(`campaign-autonomous-launch-${SLUG}`);
    await expect(launchBtn).toBeVisible();
    await expect(launchBtn).toBeEnabled();

    // Confirm dialog: exact command preview + the no-per-step-gate warning.
    await launchBtn.click();
    const dialog = page.getByTestId(`campaign-autonomous-dialog-${SLUG}`);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId(`campaign-autonomous-command-${SLUG}`)).toHaveText(
      `/shipwright-iterate --campaign ${SLUG} --autonomous`,
    );
    await expect(dialog).toContainText(/no per-step gate/i);

    // No risky pending step → no ack checkbox → confirm is enabled.
    await expect(page.getByTestId(`campaign-autonomous-ack-${SLUG}`)).toHaveCount(0);

    // Confirm → REAL create + server campaign launch branch + navigate.
    await page.getByTestId(`campaign-autonomous-confirm-${SLUG}`).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-fA-F-]{6,}/, { timeout: 15000 });
  });
});
