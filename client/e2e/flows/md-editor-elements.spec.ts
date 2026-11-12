/*
 * Spec — SmartViewer markdown editor shows and edits EVERY element without
 * damaging the file (iterate-2026-11-12-smartviewer-editor-md-roundtrip, FR-01.35).
 *
 * Reported bug: opening a document with a table in the editor and saving
 * flattened the table to its cell text; the table was not editable as a table.
 * Real Chromium, real TipTap, real mermaid; only the file GET/PUT are mocked.
 */

import { test, expect, type Page } from "@playwright/test";

import { NL } from "./markdown-editor.fixtures";

const DOC = [
  "# Elements",
  "",
  "Plain **bold** *italic* `code` and [a link](https://example.com).",
  "",
  "- bullet one",
  "- bullet two",
  "  - nested",
  "",
  "1. first",
  "2. second",
  "",
  "- [ ] open task",
  "- [x] done task",
  "",
  "> a quote",
  "",
  "| Name | Qty | Price |",
  "| --- | :---: | ---: |",
  "| Apple | 3 | 1.20 |",
  "| Pear | 5 | 2.50 |",
  "",
  "![logo](logo.png)",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[End]",
  "```",
  "",
  "````md",
  "```js",
  "inner();",
  "```",
  "````",
  "",
  "---",
  "",
  "Closing paragraph.",
  "",
].join(NL);

async function mockDoc(page: Page): Promise<{ putBody: string | null }> {
  const captured: { putBody: string | null } = { putBody: null };
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      captured.putBody = route.request().postData();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:el2", size: DOC.length }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:el1"' },
      body: DOC,
    });
  });
  return captured;
}

test.describe("@smoke markdown editor elements (FR-01.35)", () => {
  // @covers FR-01.35
  test("renders table + diagram, round-trips with NO changes, and a table edit saves as a table", { tag: ["@FR-01.35"] }, async ({ page }, testInfo) => {
    const captured = await mockDoc(page);
    await page.goto("/preview?projectId=proj-x&path=elements.md");
    await page.getByTestId("smart-viewer-edit").click();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toBeVisible();

    // The table is a real, editable grid — not flattened text.
    const table = surface.locator("table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("th")).toHaveCount(3);
    await expect(table.locator("tbody tr, tr").nth(2)).toContainText("Pear");

    // Task list items render with checkboxes.
    await expect(surface.locator('ul[data-type="taskList"] > li')).toHaveCount(2);

    // The mermaid block shows its rendered diagram under the (editable) code.
    await expect(page.getByTestId("md-mermaid-preview").locator('svg[aria-roledescription^="flowchart"]')).toBeVisible({ timeout: 15000 });

    // No edit → the whole document is byte-identical ("No changes").
    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff-summary")).toHaveText("No changes");
    await page.getByTestId("md-editor-back").click();

    // Edit a table cell, add a row through the contextual table bar.
    await surface.locator("td", { hasText: "Pear" }).first().click();
    await expect(page.getByTestId("md-editor-table-bar")).toBeVisible();
    await page.getByTestId("md-tt-row-after").click();
    await surface.locator("td", { hasText: "Pear" }).first().click();
    await page.keyboard.press("End");
    await page.keyboard.type("s");
    await page.screenshot({ path: testInfo.outputPath("md-editor-elements.png"), fullPage: true });

    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();

    const saved = captured.putBody ?? "";
    // Everything but the table edit is untouched…
    const before = DOC.split("| Name |")[0];
    const after = DOC.split("| Pear | 5 | 2.50 |")[1];
    expect(saved.startsWith(before)).toBe(true);
    expect(saved.endsWith(after.replace(/^\n/, "\n"))).toBe(true);
    // …and the table is still a GFM table (header, delimiter with alignment, 3 body rows incl. the added empty one).
    expect(saved).toContain("| Name | Qty | Price |");
    expect(saved).toContain("| --- | :---: | ---: |");
    expect(saved).toContain("| Pears | 5 | 2.50 |");
    expect(saved.split(NL).filter((l) => /^\| .* \|$/.test(l)).length).toBe(5);
  });
});
