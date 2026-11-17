/*
 * Spec — SmartViewer markdown editor edits tables WITHOUT reflowing or breaking
 * them (iterate-2026-11-17-md-editor-table-editing, FR-01.35).
 *
 * Reported: editing a document with a table "zerschiesst" the Markdown. Two real
 * causes: a `<br>` cell turned the whole table into an HTML block, and a padded
 * (column-aligned) table came back re-flowed so the diff showed every row changed.
 * Real Chromium, real TipTap; only the file GET/PUT are mocked.
 */

import { test, expect, type Page } from "@playwright/test";

import { NL } from "./markdown-editor.fixtures";

const TABLE = [
  "| Stufe         | Ordner         | Befehl                           |",
  "| :-----------: | -------------- | -------------------------------- |",
  "| Analyse       | `10-analysis/` | `/aef-analysis:analyze` (Plugin) |",
  "| **Impl Spec** | `40-impl/`     | `/aef-impl-spec:impl-spec`       |",
  "| **Code**      | Repo<br>Klon   | `:start-core`, `:start-gold`     |",
];
const w0 = "**Impl Spec**".length;
const DOC = ["# Prozess", "", ...TABLE, "", "Ende.", ""].join(NL);

async function mockDoc(page: Page): Promise<{ putBody: string | null }> {
  const captured: { putBody: string | null } = { putBody: null };
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      captured.putBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:t2", size: DOC.length }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:t1"' },
      body: DOC,
    });
  });
  return captured;
}

test.describe("@smoke markdown editor table editing (FR-01.35)", () => {
  // @covers FR-01.35
  test("a padded table with <br> is a real table, untouched = No changes, an edit keeps the layout", { tag: ["@FR-01.35"] }, async ({ page }, testInfo) => {
    const captured = await mockDoc(page);
    await page.goto("/preview?projectId=proj-x&path=process.md");
    await page.getByTestId("smart-viewer-edit").click();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface.locator("table")).toHaveCount(1);
    await expect(surface.locator("table th")).toHaveCount(3);

    // Untouched → byte-identical (before: the padded table was re-flowed).
    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff-summary")).toHaveText("No changes");
    await page.getByTestId("md-editor-back").click();

    // Edit one cell, then save: only that row changes, padding stays.
    await surface.locator("td", { hasText: "Analyse" }).first().click();
    await page.keyboard.press("End");
    await page.keyboard.type("n");
    await page.screenshot({ path: testInfo.outputPath("md-editor-table.png"), fullPage: true });
    await page.getByTestId("md-editor-review").click();
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();

    const saved = captured.putBody ?? "";
    expect(saved).toContain("<br>"); // still a pipe table, not an HTML block
    expect(saved).not.toContain("<table");
    expect(saved).toContain(`| ${"Analysen".padEnd(w0)} |`);
    for (const row of [TABLE[0], TABLE[1], TABLE[3], TABLE[4]]) expect(saved).toContain(row);
  });

  // @covers FR-01.35
  test("the table can be edited as Markdown source", { tag: ["@FR-01.35"] }, async ({ page }) => {
    const captured = await mockDoc(page);
    await page.goto("/preview?projectId=proj-x&path=process.md");
    await page.getByTestId("smart-viewer-edit").click();
    const surface = page.getByTestId("md-editor-surface");
    await surface.locator("td", { hasText: "Analyse" }).first().click();
    await page.getByTestId("md-tt-source").click();
    const input = page.getByTestId("md-table-source-input");
    await expect(input).toHaveValue(/\| Stufe/);

    // An invalid table is refused inline; a valid one is applied.
    await input.fill("| a | b |" + NL + "| - | - |" + NL + "| 1 |");
    await expect(page.getByTestId("md-table-source-status")).toContainText("Zeile 3");
    await expect(page.getByTestId("md-table-source-apply")).toBeDisabled();
    await input.fill(["| x | y |", "| - | - |", "| 1 | 2 |"].join(NL));
    await page.getByTestId("md-table-source-apply").click();
    await expect(surface.locator("table th")).toHaveCount(2);

    await page.getByTestId("md-editor-review").click();
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();
    expect(captured.putBody ?? "").toContain(["| x   | y   |", "| --- | --- |", "| 1   | 2   |"].join(NL));
  });
});
