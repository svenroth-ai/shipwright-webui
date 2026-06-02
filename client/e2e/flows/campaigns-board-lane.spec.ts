import { test, expect } from "@playwright/test";

/**
 * Campaigns lane — F0.5 web-surface E2E (FR-01.31).
 *
 * Driven against an isolated single-process stack (built worktree client
 * served by the worktree Hono via SHIPWRIGHT_STATIC_DIR, temp USERPROFILE)
 * seeded with ONE fixture project whose
 * `.shipwright/planning/iterate/campaigns/2026-06-02-campaigns-demo/` holds a
 * 2-step campaign (B0 complete / B1 pending). Because that is the only real
 * project, the board selects it on load and the lane renders.
 *
 * Covers AC-3 (lane visible when done<total), AC-4 (slug + done/total + steps),
 * AC-5 (Copy launch copies the exact /shipwright-iterate command).
 */

const SLUG = "2026-06-02-campaigns-demo";
const EXPECTED_CMD =
  '/shipwright-iterate ".shipwright/planning/iterate/campaigns/2026-06-02-campaigns-demo/sub-iterates/B1-beta.md"';

test.describe("Campaigns lane on the Task Board", () => {
  test("renders the seeded campaign with progress + a working Copy launch button", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    // AC-3 — the lane renders (the fixture campaign has done < total).
    const lane = page.getByTestId("task-board-campaigns-lane");
    await expect(lane).toBeVisible({ timeout: 15000 });
    await expect(lane.getByText("Campaigns", { exact: true })).toBeVisible();

    // AC-4 — the card shows slug + done/total + the ordered steps.
    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`campaign-progress-${SLUG}`)).toHaveText("1/2");
    await expect(page.getByTestId("campaign-step-B0")).toHaveAttribute(
      "data-step-status",
      "complete",
    );
    await expect(page.getByTestId("campaign-step-B1")).toHaveAttribute(
      "data-next",
      "true",
    );

    // AC-5 — Copy launch is enabled, labelled for the next-pending step, and
    // copies the exact /shipwright-iterate command (clipboard perms granted in
    // playwright.config.ts).
    const launch = page.getByTestId(`campaign-launch-${SLUG}`);
    await expect(launch).toBeEnabled();
    await expect(launch).toHaveText(/Copy launch \(B1\)/);
    await launch.click();
    await expect(card.getByText("Copied")).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(EXPECTED_CMD);
  });
});
