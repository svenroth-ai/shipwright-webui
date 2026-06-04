import { test, expect } from "@playwright/test";

/**
 * Campaign single-sub-iterate launch — F0.5 web-surface E2E (FR-01.36).
 *
 * Driven against an isolated single-process stack (built worktree client served
 * by the worktree Hono via SHIPWRIGHT_STATIC_DIR, temp USERPROFILE, local
 * network profile) seeded with ONE fixture project whose
 * `.shipwright/planning/iterate/campaigns/2026-06-03-autolaunch-demo/` holds a
 * 2-step ACTIVE campaign (B0 complete / B1 pending, not risky) AND the B1
 * sub-iterate spec file under `sub-iterates/` (so the server resolves a non-null
 * specPath and the Launch button is enabled). That is the only real project, so
 * the board selects it on load and the lane renders.
 *
 * Proves the per-step action end-to-end: expand → "Launch (B1)" → because B1 is
 * an ordinary (non-risky) next-pending step, a single click launches directly
 * (no confirm dialog) via the REAL server campaign-step launch branch and
 * navigates to the new task's TaskDetail (AC4/AC5).
 */

const SLUG = "2026-06-03-autolaunch-demo";

test.describe("Campaign single-step launch from the board", () => {
  test("expand → Launch (B1) → direct launch → navigates to a TaskDetail", async ({
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

    // The per-step action — labelled for the next-pending step, enabled
    // because B1 is pending with a resolved spec path + a resolved project.
    const launchBtn = page.getByTestId(`campaign-step-launch-${SLUG}`);
    await expect(launchBtn).toBeVisible();
    await expect(launchBtn).toHaveText(/Launch \(B1\)/);
    await expect(launchBtn).toBeEnabled();

    // Ordinary (non-risky) step → one click launches directly, NO dialog.
    await launchBtn.click();
    await expect(page.getByTestId(`campaign-step-dialog-${SLUG}`)).toHaveCount(0);

    // REAL create + server campaign-step launch branch + navigate.
    await expect(page).toHaveURL(/\/tasks\/[0-9a-fA-F-]{6,}/, { timeout: 15000 });
  });
});
