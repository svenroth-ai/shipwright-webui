/*
 * Spec — triage-polish-r3 (iterate-2026-11-09-triage-polish-r3, FR-01.30).
 *
 * Real-browser proof of the round-3 polish: the card list uses several
 * columns on a wide window, the project dropdown shows no task counts, Reset
 * view is the first entry of the filter menu, and the detail dialog leads
 * with the explained findings, keeps the secondary fields collapsed and has
 * its Edit button in the action row at the bottom.
 */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({
    event: "append",
    ts: "2026-11-08T08:00:00Z",
    originalTs: "2026-11-08T08:00:00Z",
    source: "compliance",
    severity: "high",
    kind: "bug",
    detail: "- B/B7: Commits not in the log — 3 commits\n- E/E1: Traceability report out of date",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: "dedup-x",
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

// @covers FR-01.30
test.describe("Triage polish round 3", () => {
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: `triage-polish-${Date.now()}` });
    await setActiveProject(page, project.projectId);
    seedTriage(project.path, [
      { id: "trg-b2000001", title: "2 open compliance findings" },
      { id: "trg-b2000002", title: "Second thing", source: "manual", detail: "plain" },
      { id: "trg-b2000003", title: "Third thing", source: "my-own-campaign", detail: "plain" },
    ]);
  });

  test.afterEach(async ({ request }) => {
    if (project) await cleanupProject(request, project);
  });

  // @covers FR-01.30
  test("cards sit in 1, 2 and 3 columns depending on the window width", async ({ page }) => {
    const ids = ["trg-b2000001", "trg-b2000002", "trg-b2000003"];
    const columns = async (): Promise<number> => {
      const xs = new Set<number>();
      for (const id of ids) {
        const box = await page.getByTestId(`triage-item-${id}`).boundingBox();
        xs.add(Math.round(box!.x));
      }
      return xs.size;
    };
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto("/triage");
    await expect(page.getByTestId(`triage-item-${ids[0]}`)).toBeVisible({ timeout: 35_000 });
    expect(await columns(), "below 1100px").toBe(1);
    await page.setViewportSize({ width: 1300, height: 900 });
    await expect.poll(columns).toBe(2);
    await page.setViewportSize({ width: 1800, height: 900 });
    await expect.poll(columns).toBe(3);
  });

  // @covers FR-01.30
  test("project dropdown has no counts and Reset view is first in the filter menu", async ({ page }) => {
    await page.goto("/triage");
    await expect(page.getByTestId("triage-item-trg-b2000001")).toBeVisible({ timeout: 35_000 });
    await expect(page.getByTestId("triage-page").getByText(/\b\d+ tasks?\b/)).toHaveCount(0);

    await page.getByTestId("triage-filter-menu-trigger").click();
    const menu = page.getByTestId("triage-filter-menu");
    const reset = page.getByTestId("triage-filter-reset-view");
    await expect(reset).toBeVisible();
    const [mb, rb] = [await menu.boundingBox(), await reset.boundingBox()];
    expect(rb!.y - mb!.y, "Reset view is the first row").toBeLessThan(48);
  });

  // @covers FR-01.30
  test("detail dialog: explained findings first, Details collapsed, Edit at the bottom", async ({ page }) => {
    await page.goto("/triage");
    await page.getByTestId("triage-item-trg-b2000001-title").click({ timeout: 35_000 });
    const modal = page.getByTestId("triage-detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("triage-detail-findings")).toContainText("What Fix now does");
    await expect(modal.getByTestId("triage-detail-more")).not.toHaveAttribute("open", "");
    await expect(modal.getByTestId("triage-help-severity-high")).toHaveCount(0);

    const [findings, edit, fix] = [
      await modal.getByTestId("triage-detail-findings").boundingBox(),
      await modal.getByTestId("triage-edit-toggle").boundingBox(),
      await modal.getByTestId("triage-fix-now").boundingBox(),
    ];
    expect(edit!.y, "Edit is below the findings").toBeGreaterThan(findings!.y);
    expect(Math.abs(edit!.y - fix!.y), "Edit shares the action row").toBeLessThan(10);

    await modal.getByTestId("triage-edit-toggle").click();
    await expect(modal.getByTestId("triage-amend-form")).toBeVisible();
  });

  // @covers FR-01.30
  test("an unknown project source shows as written with the generic help", async ({ page }) => {
    await page.goto("/triage");
    const card = page.getByTestId("triage-item-trg-b2000003");
    await expect(card.getByTestId("triage-source-my-own-campaign")).toHaveText("my-own-campaign", { timeout: 35_000 });
    await card.getByTestId("triage-help-source-my-own-campaign").click();
    await expect(page.getByTestId("triage-help-content")).toContainText("no built-in explanation");
  });
});
