import { test, expect } from "@playwright/test";

/**
 * Campaigns lane — producer-owned status filter (Option B), F0.5 web E2E
 * (iterate-2026-06-03-campaign-status-filter).
 *
 * Isolated stack seeded with ONE fixture project holding FOUR campaigns:
 *   - active   (status.json status:"active", 0/2)   → SHOWN (active wins over done=0)
 *   - draft    (status:"draft", 0/2)                → HIDDEN (planned, triage-only)
 *   - complete (status:"complete", 2/2)             → HIDDEN (done)
 *   - legacy   (no status field, 1/2)               → SHOWN (legacy done<total fallback)
 *
 * Proves: status is authoritative (draft hidden despite work remaining; active
 * shown despite zero progress; complete hidden) AND the legacy no-status
 * fallback still works (so this ships before the producer change).
 */

test.describe("Campaigns lane status filter", () => {
  test("board shows only active + legacy campaigns; draft + complete are hidden", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId("task-board-campaigns-lane")).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("campaign-lane-card-2026-06-03-active")).toBeVisible();
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-legacy")).toBeVisible();
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-draft")).toHaveCount(0);
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-complete")).toHaveCount(0);

    // exactly the two expected cards render
    await expect(page.getByTestId(/^campaign-lane-card-/)).toHaveCount(2);
  });
});
