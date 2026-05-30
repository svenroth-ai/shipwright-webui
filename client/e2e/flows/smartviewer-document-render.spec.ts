/*
 * Spec — SmartViewer document rendering + pop-out
 * (iterate-2026-05-30-smartviewer-render-ux, AC4/6/7/8 + AC5).
 *
 * Uses the new `/preview` pop-out route as a clean standalone SmartViewer
 * host: route-mocks the file API to return a markdown document carrying all
 * four problem constructs (HTML comment, leading YAML frontmatter, inline
 * `<a id>` anchor, internal `#`-link) and asserts the fixes in real Chromium —
 * including a real pane-scroll on anchor-nav (AC8).
 */

import { test, expect, type Page } from "@playwright/test";

const FILLER = Array.from(
  { length: 60 },
  (_, i) => `Filler paragraph ${i} to push the anchor target below the fold.`,
).join("\n\n");

const DOC = [
  "---",
  "canon_generated: true",
  'run_id: "iterate-x"',
  "---",
  "",
  "<!-- this comment must NOT be visible -->",
  "",
  "# Architecture",
  "",
  "See [jump to anchor](#trg-786eab1f) for the cross-reference.",
  "",
  FILLER,
  "",
  '<a id="trg-786eab1f"></a>',
  "",
  "## Requirements",
  "",
  "| Col | Value |",
  "|-----|-------|",
  "| a   | 1     |",
  "",
].join("\n");

async function mockFile(page: Page) {
  await page.route("**/api/external/projects/**/file**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      body: DOC,
    }),
  );
}

test.describe("SmartViewer document rendering (FR-03.34)", () => {
  test("hides comments, blocks frontmatter, renders anchors, scrolls in-pane, pops out", async ({
    page,
  }, testInfo) => {
    await mockFile(page);
    await page.goto("/preview?projectId=proj-x&path=architecture.md");

    const doc = page.getByTestId("document-markdown");
    await expect(doc).toBeVisible({ timeout: 5000 });

    // AC4 — the HTML comment is not visible text.
    await expect(doc).not.toContainText("this comment must NOT be visible");
    await expect(doc).not.toContainText("<!--");

    // AC6 — leading frontmatter renders as a code block (not raw body text).
    await expect(doc.locator("pre").first()).toContainText("canon_generated: true");
    await expect(doc.locator("h1")).toContainText("Architecture");

    // AC7 — inline <a id> anchor is a real element carrying its id (clobber-
    // prefixed by the sanitizer), never literal text.
    await expect(doc.locator('[id$="trg-786eab1f"]')).toHaveCount(1);
    await expect(doc).not.toContainText("<a id");

    // AC8 — clicking the internal link scrolls the pane (not the window) to the
    // target far below the fold; no hash navigation away from /preview.
    const pane = page.getByTestId("smart-viewer-markdown");
    const before = await pane.evaluate((el) => el.scrollTop);
    await page.getByRole("link", { name: "jump to anchor" }).click();
    await page.waitForTimeout(250);
    const after = await pane.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(before);
    expect(page.url()).not.toContain("#trg-786eab1f");

    // AC5 — pop-out button is present.
    await expect(page.getByTestId("smart-viewer-popout")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("smartviewer-document.png"),
      fullPage: true,
    });
  });
});
