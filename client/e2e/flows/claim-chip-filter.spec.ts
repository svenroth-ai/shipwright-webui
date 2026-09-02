import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";
import { apiUrl } from "../helpers/env";
import { patchStoreRow } from "../helpers/isolated-store";

/*
 * Claim chip + filter (FR-04.22, section 5.2, iterate-2026-09-02-claim-chip-
 * filter). Medium+ web-surface E2E required by the Phase Matrix on top of the
 * component-level Vitest coverage authored during Build (TaskCardClaimChip,
 * ClaimFilterToggle, useBoardFilters).
 *
 * `claimedBy`/`claimedAt` are daemon-owned — NOT webui-writable (CLAUDE.md
 * rule 12) — so the ordinary `seedTask` HTTP fixture cannot produce a claimed
 * task. `patchStoreRow` writes them directly to the isolated sdk-sessions.json
 * (exactly what leadwright's out-of-band claim helper does in production);
 * the running server only picks that up inside `SdkSessionsStore.persist()`'s
 * field-level 3-way merge, so a real (allowed) PATCH is issued afterwards to
 * force one before the page ever loads.
 *
 * Covers what a real browser proves that jsdom cannot:
 *   (a) the chip is visible on the card, showing who + since when.
 *   (b) it renders while `state` is anything else (never keyed on state).
 *   (c) the claim toggle is an independent filter axis; the status filter's
 *       own behaviour is unchanged.
 *   (d) a claim does not move the card's board column.
 */
async function seedClaim(
  request: import("@playwright/test").APIRequestContext,
  taskId: string,
  claimedBy: string,
  claimedAt: string,
): Promise<void> {
  patchStoreRow(taskId, { claimedBy, claimedAt });
  // Force the running server's in-memory store to merge the out-of-band
  // write in (see patchStoreRow's docstring) — an allowed, no-op-shaped
  // PATCH on the same task.
  const res = await request.patch(apiUrl(`/api/external/tasks/${taskId}`), {
    data: { tags: [] },
  });
  if (!res.ok()) {
    throw new Error(`seedClaim: trigger PATCH → HTTP ${res.status()} — ${await res.text()}`);
  }
}

test.describe("Claim chip + filter (FR-04.22)", () => {
  let project: SeededProject;
  const taskIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    project = await seedProject(request, { name: "claim-chip-filter" });
  });

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) await cleanupTask(request, id);
    taskIds.length = 0;
    await cleanupProject(request, project);
  });

  test("a claimed card shows who holds it and since when; an unclaimed one shows neither", async ({
    page,
    request,
  }) => {
    const claimed = await seedTask(request, { title: "Claimed task", projectId: project.projectId });
    const unclaimed = await seedTask(request, { title: "Unclaimed task", projectId: project.projectId });
    taskIds.push(claimed.taskId, unclaimed.taskId);

    await seedClaim(request, claimed.taskId, "po-agent", new Date(Date.now() - 10 * 60_000).toISOString());

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${claimed.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${unclaimed.taskId}`)).toBeVisible();

    const chip = page.getByTestId(`task-card-claim-${claimed.taskId}`);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("po-agent");
    await expect(page.getByTestId(`task-card-claim-since-${claimed.taskId}`)).toContainText("m ago");

    await expect(page.getByTestId(`task-card-claim-${unclaimed.taskId}`)).toHaveCount(0);
  });

  test("the chip reads claimedBy, NOT state — a done task still shows it", async ({ page, request }) => {
    const claimedDone = await seedTask(request, {
      title: "Claimed but done",
      projectId: project.projectId,
    });
    taskIds.push(claimedDone.taskId);
    await seedClaim(request, claimedDone.taskId, "po-agent", new Date().toISOString());
    // Close it (state → done) AFTER claiming, so the chip must still show —
    // proving (b): the display keys off claimedBy, never `state`.
    const closeRes = await request.post(apiUrl(`/api/external/tasks/${claimedDone.taskId}/close`));
    if (!closeRes.ok()) {
      throw new Error(`close → HTTP ${closeRes.status()} — ${await closeRes.text()}`);
    }

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${claimedDone.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${claimedDone.taskId}`)).toHaveAttribute(
      "data-task-state",
      "done",
    );
    await expect(page.getByTestId(`task-card-claim-${claimedDone.taskId}`)).toContainText("po-agent");
  });

  test("the claim toggle is its own filter axis; a claim never moves the board column", async ({
    page,
    request,
  }) => {
    const claimedDraft = await seedTask(request, {
      title: "Claimed, still backlog",
      projectId: project.projectId,
    });
    const unclaimedDraft = await seedTask(request, {
      title: "Unclaimed backlog",
      projectId: project.projectId,
    });
    taskIds.push(claimedDraft.taskId, unclaimedDraft.taskId);
    await seedClaim(request, claimedDraft.taskId, "po-agent", new Date().toISOString());

    await setActiveProject(page, project.projectId);
    await page.goto("/");
    await expect(page.getByTestId(`task-card-${claimedDraft.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${unclaimedDraft.taskId}`)).toBeVisible();

    // (d) the claim did not move it out of Backlog — draft's derived column
    // testid is "column-draft" (draft state → the Backlog column).
    await expect(page.getByTestId("column-draft")).toContainText("Claimed, still backlog");

    // (c) the status filter's own behaviour is unchanged: filtering to
    // `draft` still returns BOTH tasks — claim is a separate axis.
    const statusTrigger = page.getByTestId("board-filter-menu-trigger");
    await statusTrigger.click();
    await page.getByTestId("board-filter-menu-item-draft").click();
    await expect(page.getByTestId(`task-card-${claimedDraft.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${unclaimedDraft.taskId}`)).toBeVisible();
    await page.getByTestId("board-filter-menu-all").click();

    // The claim toggle narrows to the claimed task only, independent of
    // the (now-cleared) status filter.
    const claimToggle = page.getByTestId("board-claim-filter-toggle");
    await expect(claimToggle).toHaveAttribute("aria-pressed", "false");
    await claimToggle.click();
    await expect(claimToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`task-card-${claimedDraft.taskId}`)).toBeVisible();
    await expect(page.getByTestId(`task-card-${unclaimedDraft.taskId}`)).toHaveCount(0);

    await claimToggle.click();
    await expect(page.getByTestId(`task-card-${unclaimedDraft.taskId}`)).toBeVisible();
  });
});
