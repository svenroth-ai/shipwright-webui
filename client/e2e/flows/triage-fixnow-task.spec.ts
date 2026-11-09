/*
 * Spec — triage-fixnow-task (iterate-2026-11-09-triage-fixnow-task, FR-01.30).
 *
 * Real-browser proof for the follow-up to the Triage redesign:
 *   1. Fix now → save the task → the card shows the In progress box with the
 *      task title/state and an Open task link, Fix now / Promote / Snooze are
 *      replaced by Resolve, and the In progress tile counts and filters it.
 *   2. Resolve asks for a reason; the reason lands in triage.jsonl.
 *   3. The card's Dismiss cross opens a popup — Cancel dismisses nothing,
 *      Dismiss with a reason removes the card and stores the reason.
 * Self-seeds a project + triage.jsonl and cleans up afterwards.
 */

import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({
    event: "append",
    ts: "2026-11-09T08:00:00Z",
    originalTs: "2026-11-09T08:00:00Z",
    source: "iterate",
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

function seedTriage(projectPath: string, items: Record<string, unknown>[]): string {
  const dir = path.join(projectPath, ".shipwright");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "triage.jsonl");
  writeFileSync(
    file,
    [JSON.stringify({ v: 1, schema: "triage", created: "2026-11-09T00:00:00Z" }), ...items.map(line)].join("\n") + "\n",
    "utf-8",
  );
  return file;
}

// @covers FR-01.30
test.describe("Triage — Fix-now remembers its task, Dismiss asks for a reason", () => {
  let project: SeededProject;
  let triageFile = "";

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: `triage-fixnow-task-${Date.now()}` });
    await setActiveProject(page, project.projectId);
    triageFile = seedTriage(project.path, [
      { id: "trg-f1000001", title: "Fix target", severity: "high" },
      { id: "trg-f1000002", title: "Bystander", severity: "medium", suggestedPriority: "P2" },
    ]);
  });

  test.afterEach(async ({ request }) => {
    if (project) await cleanupProject(request, project);
  });

  // @covers FR-01.30
  test("Fix now → In progress box, tile and Resolve with a reason", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-f1000001")).toBeVisible({ timeout: 35_000 });
    await expect(page.getByTestId("triage-tile-prog")).toContainText("0");

    await page.getByTestId("triage-card-fix-now-trg-f1000001").click();
    await page.getByTestId("new-issue-save-btn").click();

    const box = page.getByTestId("triage-task-box-trg-f1000001");
    await expect(box).toBeVisible({ timeout: 15_000 });
    await expect(box).toContainText("In progress");
    await expect(box).toContainText("Fix for Fix target");
    await expect(page.getByTestId("triage-task-state-trg-f1000001")).toHaveText(/draft/i);
    await expect(page.getByTestId("triage-task-open-trg-f1000001")).toHaveAttribute("href", /\/tasks\/.+/);
    await expect(page.getByTestId("triage-card-fix-now-trg-f1000001")).toHaveCount(0);
    await expect(page.getByTestId("triage-card-promote-trg-f1000001")).toHaveCount(0);
    await expect(page.getByTestId("triage-card-resolve-trg-f1000001")).toBeVisible();
    // The other card is untouched.
    await expect(page.getByTestId("triage-card-fix-now-trg-f1000002")).toBeVisible();

    await expect(page.getByTestId("triage-tile-prog")).toContainText("1");
    await page.getByTestId("triage-tile-prog").click();
    await expect(page.getByTestId("triage-item-trg-f1000002")).toHaveCount(0);
    await expect(page.getByTestId("triage-chip-tile")).toContainText("In progress");

    // The link survives a reload (it lives on the task, not in the page).
    await page.reload();
    await expect(page.getByTestId("triage-task-box-trg-f1000001")).toBeVisible({ timeout: 35_000 });

    await page.getByTestId("triage-card-resolve-trg-f1000001").click();
    const reason = page.getByTestId("triage-dismiss-reason-trg-f1000001");
    await expect(reason).toHaveValue(/Resolved via task: Fix for Fix target/);
    await page.getByTestId("triage-dismiss-confirm-trg-f1000001").click();
    await expect(page.getByTestId("triage-item-trg-f1000001")).toHaveCount(0, { timeout: 15_000 });
    expect(readFileSync(triageFile, "utf-8")).toContain("Resolved via task: Fix for Fix target");
  });

  // @covers FR-01.30
  test("Dismiss cross: Cancel keeps the card, Dismiss stores the reason", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-f1000002")).toBeVisible({ timeout: 35_000 });

    await page.getByTestId("triage-card-dismiss-trg-f1000002").click();
    const popover = page.getByTestId("triage-dismiss-popover-trg-f1000002");
    await expect(popover).toBeVisible();
    await page.getByTestId("triage-dismiss-cancel-trg-f1000002").click();
    await expect(popover).toHaveCount(0);
    await expect(page.getByTestId("triage-item-trg-f1000002")).toBeVisible();
    expect(readFileSync(triageFile, "utf-8")).not.toContain('"dismissed"');

    await page.getByTestId("triage-card-dismiss-trg-f1000002").click();
    await page.getByTestId("triage-dismiss-reason-trg-f1000002").fill("not worth it");
    await page.getByTestId("triage-dismiss-confirm-trg-f1000002").click();
    await expect(page.getByTestId("triage-item-trg-f1000002")).toHaveCount(0, { timeout: 15_000 });
    expect(readFileSync(triageFile, "utf-8")).toContain("not worth it");
  });

  // @covers FR-01.30
  test("phone width: the Dismiss popup stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-f1000002")).toBeVisible({ timeout: 35_000 });
    await page.getByTestId("triage-card-dismiss-trg-f1000002").click();
    const box = await page.getByTestId("triage-dismiss-popover-trg-f1000002").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375 + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667 + 1);
  });
});
