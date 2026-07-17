/*
 * A11 — Mission Control "The Record" rail (FR-01.55).
 *
 * Seeded fixtures only (never operator UUIDs). A seeded task joins to NO run
 * (no shipwright_events.jsonl), so the Record renders its HONEST empty state:
 * every node is `pending` with no fabricated receipt. The nodes are still
 * clickable — the artifact opens with the node's kind + its narrator caption.
 *
 * The Mission tab is introduced NON-default (default = Files & Terminal) so the
 * terminal / auto-launch path stays byte-stable (A13's shell iterate flips the
 * default). This spec proves both: the terminal still mounts on load, and the
 * Mission tab shows the Record.
 */

import { test, expect } from "@playwright/test";
import {
  cleanupProject,
  cleanupTask,
  seedProject,
  seedTask,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

test.describe("A11 — Mission 'The Record' rail", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Record", dirName: "sw-a11-record" });
    const task = await seedTask(request, { title: "Survey the record", projectId: project.projectId });
    taskId = task.taskId;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("the terminal remains the mount-default view (auto-launch path preserved)", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    // Default top tab = Files & Terminal → the embedded terminal is present
    // without any extra navigation, exactly as before A11.
    await expect(page.getByTestId("embedded-terminal")).toBeVisible({ timeout: 15_000 });
    // getByRole("tab", {name:/terminal/i}) still resolves to the ONE center tab
    // (the top switch is plain buttons, not role=tab).
    await expect(page.getByRole("tab", { name: /terminal/i })).toHaveCount(1);
  });

  test("Mission tab shows the Record; each node opens its artifact", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const rail = page.getByTestId("record-rail");
    await expect(rail).toBeVisible();
    // FR-01.66 redesigned the left panel: the business summary + the stage stepper
    // lead, and the Req/Spec/Test/Review/Commit trail is folded into artifact links.
    await expect(page.getByTestId("mission-summary")).toBeVisible();
    await expect(page.getByTestId("mission-stage")).toBeVisible();

    // The five honest nodes render (pending, no fabricated receipts).
    for (const key of ["req", "spec", "tests", "review", "commit"] as const) {
      await expect(page.getByTestId(`record-node-${key}`)).toBeVisible();
    }
    // No run data → no fabricated "clean" / "feat" receipts anywhere.
    await expect(page.getByTestId("record-rail")).not.toContainText("clean");
    await expect(page.getByTestId("record-rail")).not.toContainText("feat");

    // Click each node → the artifact card appears with that node's kind.
    for (const key of ["req", "spec", "tests", "review", "commit"] as const) {
      await page.getByTestId(`record-node-${key}`).click();
      await expect(page.getByTestId("artifact-panel")).toBeVisible();
      await expect(page.getByTestId("artifact-panel")).toHaveAttribute("data-node", key);
    }

    // Re-clicking the active node closes the panel.
    await page.getByTestId("record-node-commit").click();
    await expect(page.getByTestId("artifact-panel")).toHaveCount(0);
  });

  test("Escape closes the artifact and returns focus to the node", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await page.getByTestId("record-node-spec").click();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("artifact-panel")).toHaveCount(0);
    await expect(page.getByTestId("record-node-spec")).toBeFocused();
  });

  test("below the compact breakpoint the artifact becomes a scrimmed slide-over", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("record-node-spec").click();

    const panel = page.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    // On the compact fallback the scrim is shown (on the inline photo card it is
    // display:none) and closes the panel.
    const scrim = page.getByTestId("artifact-scrim");
    await expect(scrim).toBeVisible();
    // The slide-over is bounded to the viewport, never wider than it.
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(800);
    // Click the EXPOSED dimmed area (top-left): the scrim spans the viewport but
    // the artifact aside sits on top of its right ~420px, so a default centre
    // click lands on the artifact (pointer-events intercept) and never closes.
    await scrim.click({ position: { x: 8, y: 8 } });
    await expect(panel).toHaveCount(0);
  });
  // (FR-01.66) The collapse-to-60px spine was retired with the audit RAIL — the
  // redesigned left panel is a static summary + stage + artifact-links card.
});
