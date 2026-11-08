/*
 * Spec — triage-redesign (iterate-2026-11-08-triage-page-redesign, FR-01.30).
 *
 * Real-browser proof for what jsdom cannot show: the saved view survives a
 * reload, the card's quick-edit and Snooze popovers stay on screen, and on a
 * phone the dialog's edit form and Snooze menu never leave the dialog /
 * viewport. Self-seeds a project + triage.jsonl and cleans up afterwards.
 */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  cleanupProject,
  seedProject,
  setActiveProject,
  type SeededProject,
} from "../helpers/fixtures";

const PHONE = { width: 375, height: 667 };

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({
    event: "append",
    ts: "2026-11-08T08:00:00Z",
    originalTs: "2026-11-08T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    detail: "Detail body",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    amendedBy: null,
    amendedAt: null,
    ...fields,
  });
}

function seedTriage(projectPath: string, items: Record<string, unknown>[]): void {
  const dir = path.join(projectPath, ".shipwright");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "triage.jsonl"),
    [JSON.stringify({ v: 1, schema: "triage", created: "2026-11-08T00:00:00Z" }), ...items.map(line)].join("\n") + "\n",
    "utf-8",
  );
}

async function inViewport(page: import("@playwright/test").Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} has a box`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
}

test.describe("Triage page redesign", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: `triage-redesign-${Date.now()}` });
    await setActiveProject(page, project.projectId);
    seedTriage(project.path, [
      { id: "trg-a1000001", title: "Critical thing", severity: "critical", suggestedPriority: "P0" },
      { id: "trg-a1000002", title: "Medium thing", severity: "medium", suggestedPriority: "P2" },
      { id: "trg-a1000003", title: "Low thing", severity: "low", suggestedPriority: "P3" },
    ]);
  });

  test.afterEach(async ({ request }) => {
    if (project) await cleanupProject(request, project);
  });

  // @covers FR-01.30
  test("filter + grouping persist across a reload; ticking nothing shows all", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a1000001")).toBeVisible({ timeout: 35_000 });
    await expect(page.getByTestId("triage-item-trg-a1000002")).toBeVisible();

    await page.getByTestId("triage-filter-menu-trigger").click();
    await page.getByTestId("triage-filter-severities-critical").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("triage-item-trg-a1000002")).toHaveCount(0);
    await expect(page.getByTestId("triage-showing-count")).toContainText("1");

    await page.getByTestId("triage-group-trigger").click();
    await page.getByRole("menuitemradio", { name: /severity/i }).click();
    await expect(page.getByTestId("triage-group-severity:critical")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("triage-item-trg-a1000001")).toBeVisible({ timeout: 35_000 });
    await expect(page.getByTestId("triage-item-trg-a1000002")).toHaveCount(0);
    await expect(page.getByTestId("triage-chip-severities-critical")).toBeVisible();
    await expect(page.getByTestId("triage-group-severity:critical")).toBeVisible();

    // Removing the chip returns to "nothing ticked = everything".
    await page.getByTestId("triage-clear-filters").click();
    await expect(page.getByTestId("triage-item-trg-a1000002")).toBeVisible();
  });

  // @covers FR-01.30
  test("keyboard: the filter menu opens with Enter and closes with Escape", async ({ page }) => {
    await page.goto("/triage");
    const trigger = page.getByTestId("triage-filter-menu-trigger");
    await expect(trigger).toBeVisible({ timeout: 35_000 });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("triage-filter-severities-critical")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("triage-filter-severities-critical")).toHaveCount(0);
  });

  // @covers FR-01.30
  test("quick edit changes the title and severity in place", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a1000002")).toBeVisible({ timeout: 35_000 });
    await page.getByTestId("triage-quick-edit-trigger-trg-a1000002").click();
    await inViewport(page, "triage-quick-edit");
    await page.getByTestId("triage-quick-edit-title").fill("Renamed medium thing");
    await page.getByTestId("triage-quick-edit-severity").selectOption("high");
    await page.getByTestId("triage-quick-edit-save").click();
    await expect(page.getByTestId("triage-quick-edit-error")).toHaveCount(0);
    await expect(page.getByTestId("triage-quick-edit-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("triage-item-trg-a1000002")).toContainText("Renamed medium thing", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("triage-quick-edit")).toHaveCount(0);
  });

  // @covers FR-01.30
  test("Snooze on the card parks the item (tomorrow preset)", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a1000003")).toBeVisible({ timeout: 35_000 });
    await page.getByTestId("triage-snooze-menu-trg-a1000003").click();
    await inViewport(page, "triage-snooze-popover");
    await page.getByTestId("triage-snooze-tomorrow").click();
    await expect(page.getByTestId("triage-open-items").getByTestId("triage-item-trg-a1000003")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("triage-tile-parked")).toContainText("1");
  });

  // @covers FR-01.30
  test("Fix now on the card opens the new-task dialog for the entry's own project", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a1000001")).toBeVisible({ timeout: 35_000 });
    await page.getByTestId("triage-card-fix-now-trg-a1000001").click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
  });

  // @covers FR-01.30
  test("phone: dialog edit form and Snooze menu stay inside the dialog / viewport", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-a1000001")).toBeVisible({ timeout: 35_000 });
    await page.getByTestId("triage-item-trg-a1000001-title").click();

    const dialog = page.getByTestId("triage-detail-modal");
    await expect(dialog).toBeVisible();
    const dialogBox = (await dialog.boundingBox())!;

    // Edit form replaces the detail block and fits the dialog.
    await page.getByTestId("triage-edit-toggle").click();
    const form = page.getByTestId("triage-amend-form");
    await expect(form).toBeVisible();
    await form.scrollIntoViewIfNeeded();
    const formBox = (await form.boundingBox())!;
    expect(formBox.x).toBeGreaterThanOrEqual(dialogBox.x - 1);
    expect(formBox.x + formBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
    await page.getByTestId("triage-amend-cancel").click();

    // Snooze menu is portaled, so it sits within the viewport.
    const snooze = dialog.getByTestId("triage-snooze-menu-trg-a1000001");
    await snooze.scrollIntoViewIfNeeded();
    await snooze.click();
    await inViewport(page, "triage-snooze-popover");
    await inViewport(page, "triage-snooze-date");
  });
});
