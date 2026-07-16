/*
 * A13 — Mission Control three-card SHELL (FR-01.57): the top row, the segmented
 * tab row, and the three equal-height glass cards that float on the photo with the
 * dark scrim REMOVED.
 *
 * Seeded fixtures only (never operator UUIDs). This proves the shell contracts the
 * unit suite can't see in jsdom (real layout): at 1440×900 nothing overflows
 * horizontally with the artifact open, the three cards render at identical height,
 * the rail collapses, the Files & Terminal tab still mounts the REAL terminal
 * (byte-path untouched), and below the compact breakpoint the artifact becomes the
 * scrimmed slide-over. It also proves the demo "Preview state" toggle does NOT ship.
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

test.describe("A13 — Mission three-card shell", () => {
  let project: SeededProject;
  let taskId: string;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "Shell", dirName: "sw-a13-shell" });
    const task = await seedTask(request, { title: "Frame the mission", projectId: project.projectId });
    taskId = task.taskId;
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupTask(request, taskId);
    await cleanupProject(request, project);
  });

  test("at 1440×900 the three cards fit with no horizontal clip and are equal height (AC1/AC2)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    const body = page.getByTestId("mission-body");
    await expect(body).toBeVisible();
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await expect(page.getByTestId("operation-card")).toBeVisible();

    // Open the artifact — now three cards share the row.
    await page.getByTestId("record-node-req").click();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();

    // AC1 — on the photo (desktop) there is NO scrim/dimming panel behind the row.
    // The artifact's own .a-scrim element exists in the DOM but is display:none
    // here (it is only the compact slide-over overlay); assert it is not visible.
    await expect(page.getByTestId("artifact-scrim")).not.toBeVisible();

    // Fable B4: nothing overflows the body horizontally with the artifact open —
    // AND the document itself does not clip at 1440 (an ancestor/body wider than
    // the viewport would still pass a body-only self-comparison).
    const overflow = await body.evaluate(
      (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }),
    );
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    const docOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(docOverflow.scrollWidth).toBeLessThanOrEqual(docOverflow.clientWidth + 1);

    // Equal height: the three cards render at (near-)identical height.
    const rail = await page.getByTestId("record-rail").boundingBox();
    const op = await page.getByTestId("operation-card").boundingBox();
    const art = await page.getByTestId("artifact-panel").boundingBox();
    expect(Math.abs(rail!.height - op!.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(op!.height - art!.height)).toBeLessThanOrEqual(2);

    // Operation stays usable — it shrinks but keeps a comfortable min-width at 1440.
    expect(op!.width).toBeGreaterThanOrEqual(360);
  });

  test("the rail collapses; the shell stays clip-free collapsed", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();

    await page.getByTestId("record-collapse").click();
    await expect(page.getByTestId("record-rail")).toHaveAttribute("data-collapsed", "true");

    const body = page.getByTestId("mission-body");
    const overflow = await body.evaluate(
      (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }),
    );
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("Files & Terminal still mounts the REAL terminal (byte-path untouched)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);

    // Files & Terminal is the mount-default (A13 kept it) → the terminal attaches.
    const term = page.getByTestId("embedded-terminal");
    await expect(term).toBeVisible({ timeout: 15_000 });
    await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 20_000 });

    // Switch to Mission and back — the WS is never torn down (still ready).
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("record-rail")).toBeVisible();
    await page.getByTestId("mission-tab-files").click();
    await expect(term).toHaveAttribute("data-ws-ready", "true");

    // The segmented switch adds no stray tab role — the ONE center Terminal tab.
    await expect(page.getByRole("tab", { name: /terminal/i })).toHaveCount(1);
  });

  test("below the compact breakpoint the artifact falls back to the scrimmed slide-over", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await page.getByTestId("record-node-spec").click();

    const panel = page.getByTestId("artifact-panel");
    await expect(panel).toBeVisible();
    const scrim = page.getByTestId("artifact-scrim");
    await expect(scrim).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(800);
  });

  test("the demo 'Preview state' toggle does NOT ship (AC5)", async ({ page }) => {
    await page.goto(`/tasks/${taskId}`);
    await page.getByTestId("mission-tab-mission").click();
    await expect(page.getByTestId("record-rail")).toBeVisible();
    // The prototype's state switcher is a demo affordance — no user control ships.
    await expect(page.getByText(/preview state/i)).toHaveCount(0);
    await expect(page.getByTestId("mission-state-toggle")).toHaveCount(0);
  });

  test("the top row is complete: both crumb segments + the glass Ship's Log button route real", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/tasks/${taskId}`);

    const board = page.getByTestId("task-detail-crumb-board");
    const proj = page.getByTestId("task-detail-crumb-project");
    await expect(board).toHaveAttribute("href", "/");
    await expect(proj).toHaveAttribute("href", "/projects");

    // The Ship's Log button routes somewhere real (projects until A16), never dead.
    await expect(page.getByTestId("mission-open-ships-log")).toHaveAttribute("href", "/projects");
  });
});
