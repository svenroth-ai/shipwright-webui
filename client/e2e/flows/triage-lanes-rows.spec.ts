/*
 * Spec — triage-lanes-rows (iterate-2026-11-12-triage-lanes-rows).
 * Real-browser proof of the Triage lanes: severity + selectable id + copy
 * button before the title, hover-only action buttons (pencil beside them),
 * and project lanes the user can put in their own order, remembered across a
 * reload. jsdom has no layout engine or real pointer drag.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupProject, seedProject, type SeededProject } from "../helpers/fixtures";

const line = (id: string, title: string) =>
  JSON.stringify({
    event: "append", id, ts: "2026-11-12T08:00:00Z", originalTs: "2026-11-12T08:00:00Z",
    source: "manual", severity: "high", kind: "bug", title, detail: "Explanation that only the dialog shows",
    evidencePath: null, runId: null, commit: null, dedupKey: null, status: "triage",
    suggestedPriority: "P1", suggestedDomain: "engineering", statusBy: null, statusReason: null,
    promotedTaskId: null, revisitAt: null, revisitDue: false, amendedBy: null, amendedAt: null,
  });

function seedTriage(p: SeededProject, id: string, title: string): void {
  const dir = path.join(p.path, ".shipwright");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "triage.jsonl"),
    [JSON.stringify({ v: 1, schema: "triage", created: "2026-11-12T00:00:00Z" }), line(id, title)].join("\n") + "\n",
    "utf-8",
  );
}

let a: SeededProject;
let b: SeededProject;
test.beforeEach(async ({ request }) => {
  const stamp = Date.now();
  a = await seedProject(request, { name: `lane-a-${stamp}` });
  b = await seedProject(request, { name: `lane-b-${stamp}` });
  seedTriage(a, "trg-lane0001", "First lane item with a reasonably long title that should stay fully readable");
  seedTriage(b, "trg-lane0002", "Second lane item");
});
test.afterEach(async ({ request }) => {
  await cleanupProject(request, a);
  await cleanupProject(request, b);
});

// @covers FR-01.30
test("a row shows severity, the selectable id and a copy button before the title; actions show on hover", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1500, height: 900 }); // wide enough for the hover strip
  await page.goto("/triage");
  const row = page.getByTestId("triage-item-trg-lane0001");
  await expect(row).toBeVisible({ timeout: 35_000 });

  const sev = await page.getByTestId("triage-severity-high").first().boundingBox();
  const id = await page.getByTestId("triage-item-trg-lane0001-id").boundingBox();
  const title = await page.getByTestId("triage-item-trg-lane0001-title").boundingBox();
  expect(sev!.x).toBeLessThan(id!.x);
  expect(id!.x).toBeLessThan(title!.x);
  await expect(row).not.toContainText("Explanation that only the dialog shows");

  // Hover reveals the buttons, with the pencil next to them.
  const actions = page.getByTestId("triage-row-actions-trg-lane0001");
  await expect(actions).toBeHidden();
  await row.hover();
  await expect(actions).toBeVisible();
  await expect(actions.getByTestId("triage-quick-edit-trigger-trg-lane0001")).toBeVisible();

  // The overlay never covers the title: the title text ends left of the buttons.
  const t2 = await page.getByTestId("triage-item-trg-lane0001-title").boundingBox();
  const a2 = await actions.boundingBox();
  expect(t2!.x + t2!.width).toBeLessThanOrEqual(a2!.x + 1);

  // The strip stays while its Dismiss popover is open, even with the mouse elsewhere.
  await page.getByTestId("triage-card-dismiss-trg-lane0001").click();
  await expect(page.getByTestId("triage-dismiss-popover-trg-lane0001")).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(actions).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("triage-dismiss-popover-trg-lane0001")).toHaveCount(0);
  await row.hover();

  // Copy button puts exactly the id on the clipboard and does not open the dialog.
  await page.getByTestId("triage-item-trg-lane0001-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("trg-lane0001");
  await expect(page.getByTestId("triage-detail-modal")).toHaveCount(0);

  // Double-click selects the id without opening the dialog.
  await page.getByTestId("triage-item-trg-lane0001-id").dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe("trg-lane0001");
  await expect(page.getByTestId("triage-detail-modal")).toHaveCount(0);
});

// @covers FR-01.30
test("project lanes can be reordered by their handle and the order is remembered", async ({ page }) => {
  await page.goto("/triage");
  await expect(page.getByTestId("triage-item-trg-lane0001")).toBeVisible({ timeout: 35_000 });
  const lanes = page.locator('[data-testid^="triage-group-project:"]:not([data-testid*="handle"]):not([data-testid*="toggle"])');
  const firstText = async () => (await lanes.first().innerText()).includes("trg-lane0001");
  const aFirst = await firstText();

  // Keyboard: arrow down on the first lane's handle moves it one place.
  const firstHandle = lanes.first().locator('[data-testid^="triage-group-handle-"]');
  await firstHandle.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(firstText).toBe(!aFirst);
  // Focus stays on the moved lane's handle so a second key press keeps working.
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "")).toMatch(/^triage-group-handle-/);

  // Mouse drag: drag the (new) second lane's handle back over the first lane.
  const handle = lanes.nth(1).locator('[data-testid^="triage-group-handle-"]');
  const target = await lanes.first().boundingBox();
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 20, { steps: 4 });
  await page.mouse.move(target!.x + 60, target!.y + target!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(firstText).toBe(aFirst);

  // Move once more, reload: the order sticks.
  await lanes.first().locator('[data-testid^="triage-group-handle-"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(firstText).toBe(!aFirst);
  await page.reload();
  await expect(page.getByTestId("triage-item-trg-lane0001")).toBeVisible({ timeout: 35_000 });
  expect(await firstText()).toBe(!aFirst);
});
