import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { test, expect } from "@playwright/test";

/**
 * Campaigns lane — tracked events.jsonl projection, F0.5 web E2E
 * (iterate-2026-06-11-campaign-events-projection, FR-01.33).
 *
 * The deployed-board path: a fresh clone / redeploy has NO campaign planning
 * dir (gitignored/local-only, PR #121 / monorepo PR #189), so the board used to
 * show nothing. This stack seeds ONE fixture project with NO campaigns dir but a
 * tracked `<projectRoot>/shipwright_events.jsonl` carrying two S1-stamped
 * `work_completed` events (top-level `campaign` + `sub_iterate_id`) for
 * `2026-06-11-ghost-deploy` (C1, C2). The server projects them into a
 * `derivedFromEvents` campaign so the board still surfaces progress.
 *
 * Proves end-to-end (browser → /api/campaigns → projectCampaignEvents): a
 * skeleton-less campaign renders on the lane with the "events" provenance badge,
 * 2/2 progress, and both sub-iterates shown complete — even though no
 * status.json / campaign.md exists on this checkout.
 */

const SLUG = "2026-06-11-ghost-deploy";

test.describe("Campaigns lane — events.jsonl projection (deployed clone)", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "campaign-events-projection" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("surfaces a derived campaign with the events badge when no campaign dir exists", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const lane = page.getByTestId("task-board-campaigns-lane");
    await expect(lane).toBeVisible({ timeout: 15000 });

    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible();
    // Provenance badge — this campaign was reconstructed from the event log.
    await expect(page.getByTestId(`campaign-events-badge-${SLUG}`)).toBeVisible();
    // Both completed sub-iterates are projected → 2/2.
    await expect(page.getByTestId(`campaign-progress-${SLUG}`)).toHaveText("2/2");

    // Expand the card and confirm both steps render complete.
    await page.getByTestId(`campaign-toggle-${SLUG}`).click();
    await expect(page.getByTestId("campaign-step-C1")).toHaveAttribute(
      "data-step-status",
      "complete",
    );
    await expect(page.getByTestId("campaign-step-C2")).toHaveAttribute(
      "data-step-status",
      "complete",
    );
  });
});
