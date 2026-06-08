import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Campaign attached-run guard — F0.5 web-surface E2E
 * (iterate-2026-06-08-campaign-attached-run-guard).
 *
 * End-to-end proof of the double-launch guard through the REAL stack: seeds a
 * fixture project whose `.shipwright/loop_state.json` carries a live
 * `in_progress` sub_iterate unit for an ACTIVE campaign, then asserts the board
 * renders BOTH launch CTAs disabled + relabeled "Run attached". This exercises
 * the real route (`GET /api/campaigns` → readLoopAttachments → attachedRun) and
 * the real client wiring (TaskBoardPage → useCampaigns → CampaignLaneCard →
 * launch buttons) — not a stub.
 *
 * The project is selected via `?projectId=<id>` (URL wins over auto-select), so
 * the test is robust regardless of other registered projects. Self-seeds via
 * the real POST /api/projects + on-disk writes (mirrors pr-card-status.spec.ts)
 * and cleans up the registration + temp dir afterwards.
 */

const SLUG = "2026-06-08-attached-guard-demo";

test.describe("Campaign attached-run guard on the board", () => {
  let projectDir = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("a live loop unit disables + relabels both launch CTAs ('Run attached')", async ({
    page,
    request,
  }) => {
    // ── seed a fixture project on disk ──────────────────────────────────────
    projectDir = path.join(tmpdir(), `attached-guard-${Date.now()}`);
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

    // ACTIVE campaign, B0 complete / B1 pending → shown on the board lane.
    writeFileSync(
      path.join(campaignDir, "campaign.md"),
      `---\ncampaign: ${SLUG}\nbranch_strategy: stacked\n---\n\n# Campaign: ${SLUG}\n\n## Intent\n\nProve the attached-run guard.\n\n## Sub-Iterates\n\n| ID | Slug | Title | Status |\n|---|---|---|---|\n| B0 | alpha | Alpha | complete |\n| B1 | beta | Beta | pending |\n`,
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

    // The attached-run signal: a LIVE in_progress loop unit for B1. status.json
    // still says pending, so attachedRun can ONLY come from loop_state.json —
    // i.e. this proves the loop_state path end-to-end.
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
      data: { name: "attached-guard-demo", path: projectDir.split(path.sep).join("/") },
    });
    expect(created.ok()).toBeTruthy();
    projectId = ((await created.json()) as { data: { id: string } }).data.id;

    // ── drive the board for that project ────────────────────────────────────
    await page.goto(`/?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByTestId("task-board-page")).toBeVisible();

    const card = page.getByTestId(`campaign-lane-card-${SLUG}`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await page.getByTestId(`campaign-toggle-${SLUG}`).click();

    // Autonomous CTA: disabled + relabeled.
    const autoBtn = page.getByTestId(`campaign-autonomous-launch-${SLUG}`);
    await expect(autoBtn).toBeVisible();
    await expect(autoBtn).toBeDisabled();
    await expect(autoBtn).toHaveText(/Run attached/);

    // Per-step CTA: disabled + relabeled.
    const stepBtn = page.getByTestId(`campaign-step-launch-${SLUG}`);
    await expect(stepBtn).toBeVisible();
    await expect(stepBtn).toBeDisabled();
    await expect(stepBtn).toHaveText(/Run attached/);

    // The confirm dialog is unreachable while the trigger is disabled (asserted
    // above) — so it must not be present in the DOM.
    await expect(page.getByTestId(`campaign-autonomous-dialog-${SLUG}`)).toHaveCount(0);
  });
});
