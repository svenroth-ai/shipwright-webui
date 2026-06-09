import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Campaign board live per-step progress — F0.5 web-surface E2E
 * (iterate-2026-06-09-campaign-board-live-progress).
 *
 * End-to-end proof of the live in_progress overlay through the REAL stack:
 * status.json says B1 is `pending`, but a live `loop_state.json` `in_progress`
 * unit names B1. The board must render B1 as `in_progress` (spinner + label) —
 * proving `GET /api/campaigns` (readLoopRunState → per-step overlay) reaches the
 * real client wiring (TaskBoardPage → useCampaigns → CampaignLaneCard StepIcon).
 * Without the overlay the step would render as the plain next-pending marker, so
 * the `data-step-status="in_progress"` attribute can ONLY come from loop_state.
 *
 * Seeding mirrors campaign-attached-run-guard.spec.ts (proven in the isolated
 * stack): self-seeds via the real POST /api/projects + on-disk writes, selects
 * the project via `?projectId=` (URL wins over auto-select), cleans up after.
 */

const SLUG = "2026-06-09-live-progress-demo";

test.describe("Campaign board live per-step in_progress overlay", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("a live loop unit marks its step in_progress on the board (overrides next-marker)", async ({
    page,
    request,
  }) => {
    // ── seed a fixture project on disk ──────────────────────────────────────
    projectDir = path.join(tmpdir(), `live-progress-${Date.now()}`);
    const campaignDir = path.join(
      projectDir,
      ".shipwright",
      "planning",
      "iterate",
      "campaigns",
      SLUG,
    );
    const subDir = path.join(campaignDir, "sub-iterates");
    mkdirSync(subDir, { recursive: true });

    // ACTIVE campaign, B0 complete / B1 pending (per status.json).
    writeFileSync(
      path.join(campaignDir, "campaign.md"),
      `---\ncampaign: ${SLUG}\nbranch_strategy: stacked\n---\n\n# Campaign: ${SLUG}\n\n## Intent\n\nProve the live per-step overlay.\n\n## Sub-Iterates\n\n| ID | Slug | Title | Status |\n|---|---|---|---|\n| B0 | alpha | Alpha | complete |\n| B1 | beta | Beta | pending |\n`,
      "utf-8",
    );
    writeFileSync(
      path.join(campaignDir, "status.json"),
      JSON.stringify({
        status: "active",
        branch_strategy: "stacked",
        sub_iterates: [
          { id: "B0", slug: "alpha", status: "complete" },
          { id: "B1", slug: "beta", status: "pending" },
        ],
      }),
      "utf-8",
    );
    writeFileSync(path.join(subDir, "B1-beta.md"), "# B1\n", "utf-8");

    // The live signal: an in_progress loop unit for B1. status.json still says
    // pending, so an in_progress board render can ONLY come from loop_state.json.
    writeFileSync(
      path.join(projectDir, ".shipwright", "loop_state.json"),
      JSON.stringify({
        loop_id: "sub_iterate-e2e",
        kind: "sub_iterate",
        branch_strategy: "stacked",
        units: [
          {
            id: "B1",
            status: "in_progress",
            spec_path: `.shipwright/planning/iterate/campaigns/${SLUG}/sub-iterates/B1-beta.md`,
            started_at: new Date().toISOString(),
          },
        ],
      }),
      "utf-8",
    );

    // ── register the project via the REAL API ───────────────────────────────
    const created = await request.post("/api/projects", {
      data: { name: "live-progress-demo", path: projectDir.split(path.sep).join("/") },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    // ── drive the board for that project ────────────────────────────────────
    await page.goto(`/?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await page.getByTestId(`campaign-toggle-${SLUG}`).click();

    // B1 — overlaid in_progress (the core assertion): attribute + spinner icon +
    // status label, despite status.json reporting it pending.
    const stepB1 = page.getByTestId("campaign-step-B1");
    await expect(stepB1).toBeVisible();
    await expect(stepB1).toHaveAttribute("data-step-status", "in_progress");
    await expect(stepB1.getByLabel("in progress")).toBeVisible();
    await expect(stepB1).toContainText("in_progress");

    // B0 stays complete (status.json authoritative, not overlaid).
    await expect(page.getByTestId("campaign-step-B0")).toHaveAttribute(
      "data-step-status",
      "complete",
    );
  });
});
