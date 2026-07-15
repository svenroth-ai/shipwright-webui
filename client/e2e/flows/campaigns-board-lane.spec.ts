import { seedCampaigns } from "../helpers/campaign-fixture";
import { cleanupProject, seedLocalStorage, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
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

test.describe("Campaigns lane on the Task Board", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "campaigns-board-lane" });

    seedCampaigns(project.path, [
      {
        slug: "2026-06-02-campaigns-demo",
        status: "active",
        subIterates: [
          { id: "B0", slug: "alpha", status: "complete" },
          { id: "B1", slug: "beta", status: "pending" },
        ],
      },
    ]);
    await setActiveProject(page, project.projectId);
    // The lane card is COLLAPSED by default (per-slug localStorage). The ordered
    // steps this spec asserts on only render when expanded — it used to inherit
    // the developer's own click. Seed the expanded state.
    await seedLocalStorage(page, { [`webui:campaign-card-collapsed:${SLUG}`]: "false" });
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("renders the seeded campaign with progress + a working per-step Launch button", async ({
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

    // AC-5 — the per-step Launch button. A00: the old `campaign-launch-<slug>`
    // "Copy launch" CLIPBOARD button was removed (FR-01.34) and replaced by
    // `campaign-step-launch-<slug>` (CampaignStepLaunchButton.tsx). It is enabled,
    // labelled for the next-pending step B1, and — because B1 is an ordinary
    // (non-risky) next step — a single click launches DIRECTLY: it creates a task
    // and navigates to its TaskDetail, where the embedded terminal auto-executes the
    // /shipwright-iterate command. It no longer copies to the clipboard.
    const launch = page.getByTestId(`campaign-step-launch-${SLUG}`);
    await expect(launch).toBeEnabled();
    await expect(launch).toHaveText(/Launch \(B1\)/);
    await launch.click();
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 10000 });
  });
});
