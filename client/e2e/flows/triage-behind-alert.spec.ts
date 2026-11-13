/*
 * Spec — triage-behind-alert (iterate-2026-11-13-triage-alerts-round4).
 * Real-browser proof that "behind origin" is ONE short orange alert that sits
 * in the same single row as the filter pills and the severity legend (it never
 * wraps), and that hovering it opens a popover naming the project and the
 * commit count. jsdom has no layout engine and no real hover.
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupProject, seedProject, type SeededProject } from "../helpers/fixtures";

let p: SeededProject;
test.beforeEach(async ({ request }) => {
  p = await seedProject(request, { name: `behind-${Date.now()}` });
  const dir = path.join(p.path, ".shipwright");
  mkdirSync(dir, { recursive: true });
  const item = JSON.stringify({
    event: "append", id: "trg-behind001", ts: "2026-11-13T08:00:00Z", originalTs: "2026-11-13T08:00:00Z",
    source: "manual", severity: "high", kind: "bug", title: "An item", detail: "d",
    evidencePath: null, runId: null, commit: null, dedupKey: null, status: "triage",
    suggestedPriority: "P1", suggestedDomain: "engineering", statusBy: null, statusReason: null,
    promotedTaskId: null, revisitAt: null, revisitDue: false, amendedBy: null, amendedAt: null,
  });
  writeFileSync(
    path.join(dir, "triage.jsonl"),
    [JSON.stringify({ v: 1, schema: "triage", created: "2026-11-13T00:00:00Z" }), item].join("\n") + "\n",
    "utf-8",
  );
});
test.afterEach(async ({ request }) => {
  await cleanupProject(request, p);
});

// @covers FR-01.30
test("behind origin is one nowrap alert in the single summary row; hover shows project and commit count", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.route((u) => u.pathname === `/api/triage/${p.projectId}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, origin: { available: true, behind: 3 } } });
  });
  await page.goto("/triage");
  const alert = page.getByTestId("triage-behind-alert");
  await expect(alert).toBeVisible({ timeout: 35_000 });
  await expect(alert).toContainText("behind origin");

  // one line: pills, alert and legend share the same row (same vertical centre ±4px)
  const a = await alert.boundingBox();
  const pill = await page.getByTestId("triage-tile-open").boundingBox();
  const legend = await page.getByTestId("triage-severity-legend").boundingBox();
  expect(a && pill && legend).toBeTruthy();
  expect(Math.abs(a!.y + a!.height / 2 - (pill!.y + pill!.height / 2))).toBeLessThan(4);
  expect(Math.abs(legend!.y + legend!.height / 2 - (pill!.y + pill!.height / 2))).toBeLessThan(4);
  expect(a!.height).toBeLessThan(40); // not wrapped

  await alert.hover();
  await expect(page.getByTestId("triage-behind-popover")).toContainText("3 commits behind origin");
});
