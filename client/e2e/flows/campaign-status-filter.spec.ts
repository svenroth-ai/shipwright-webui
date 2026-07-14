import { seedCampaigns } from "../helpers/campaign-fixture";
import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

/**
 * Campaigns lane — producer-owned status filter (Option B), F0.5 web E2E
 * (iterate-2026-06-03-campaign-status-filter).
 *
 * Isolated stack seeded with ONE fixture project holding FIVE campaigns:
 *   - active      (status.json status:"active", 0/2)   → SHOWN (active wins over done=0)
 *   - draft       (status:"draft", 0/2)                → HIDDEN (planned, triage-only)
 *   - complete    (status:"complete", 2/2)             → HIDDEN (done)
 *   - legacy      (no status field, 1/2)               → SHOWN (legacy done<total fallback)
 *   - active-done (status:"active", 2/2)               → HIDDEN (every step done; the
 *                                                         producer never flipped the stale
 *                                                         `active` lifecycle to `complete`
 *                                                         — iterate-2026-06-05 regression)
 *
 * Proves: status is authoritative (draft hidden despite work remaining; active
 * shown despite zero progress; complete hidden), the legacy no-status fallback
 * still works, AND a done==total campaign is hidden even when its lifecycle is
 * a stale `active` (the 2026-06-05 bug: such a campaign rendered forever).
 */

test.describe("Campaigns lane status filter", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "campaign-status-filter" });

    // A00 — the five campaigns this spec asserts on were never created by it: it
    // assumed a "fixture project" already on the developer's disk. Seed them into
    // the project's own dir; the server reads campaigns straight off the filesystem.
    seedCampaigns(project.path, [
      { slug: "2026-06-03-active", status: "active", total: 3, done: 1 },
      { slug: "2026-06-03-draft", status: "draft", total: 2, done: 0 },
      { slug: "2026-06-03-complete", status: "complete", total: 2, done: 2 },
      // Regression guard (2026-06-05): an `active` campaign at done==total must be
      // HIDDEN — such a campaign used to render forever.
      { slug: "2026-06-03-active-done", status: "active", total: 2, done: 2 },
      // LEGACY: no lifecycle at all — the back-compat path must still show it.
      { slug: "2026-06-03-legacy", total: 3, done: 1 },
    ]);

    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("board shows only active + legacy campaigns; draft, complete, and stale-active-done are hidden", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();
    await expect(page.getByTestId("task-board-campaigns-lane")).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("campaign-lane-card-2026-06-03-active")).toBeVisible();
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-legacy")).toBeVisible();
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-draft")).toHaveCount(0);
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-complete")).toHaveCount(0);
    // Regression guard (2026-06-05): an `active` campaign at done==total is hidden.
    // The fixture must seed `2026-06-03-active-done` (status "active", 2/2).
    await expect(page.getByTestId("campaign-lane-card-2026-06-03-active-done")).toHaveCount(0);

    // exactly the two expected cards render (active + legacy)
    await expect(page.getByTestId(/^campaign-lane-card-/)).toHaveCount(2);
  });
});
