/*
 * Spec — SmartViewer in-app Markdown editor (FR-01.34).
 *
 * Drives the real /preview SmartViewer (popOut=true → Edit button) in Chromium.
 * Both the GET (load) and PUT (save) file endpoints are route-mocked so the
 * test needs no live backend; after a successful PUT the GET mock serves
 * updated content to prove the preview re-fetches (AC5b).
 *
 *   AC1 Edit button visible · AC2 modal loads file as rich text ·
 *   AC4 Review → diff gate · AC5 Save → PUT + preview refresh ·
 *   AC6 409 → conflict banner + edits preserved.
 */

import { test, expect } from "@playwright/test";

import {
  NL,
  mockApi,
  mockFrontmatterFile,
  mockBlogFile,
} from "./markdown-editor.fixtures";

test.describe("SmartViewer markdown editor (FR-01.34)", () => {
  test("Edit → rich editor → Review → Save → preview refreshes", async ({ page }, testInfo) => {
    await mockApi(page);
    await page.goto("/preview?projectId=proj-x&path=README.md");

    // AC2 — preview renders the original content.
    await expect(page.getByTestId("document-markdown")).toContainText("Original body paragraph");

    // AC1 — Edit button visible on the markdown pane.
    const editBtn = page.getByTestId("smart-viewer-edit");
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Modal opens with the rich editor pre-populated from the file.
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("Original body paragraph");

    // Exercise real editor input.
    await surface.click();
    await page.keyboard.type(" EDITED");

    // AC4 — Review opens the pre-save diff.
    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();

    // AC5 — Save: PUT fires, modal closes, preview re-fetches updated content.
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();
    await expect(page.getByTestId("document-markdown")).toContainText("Saved new body paragraph");

    await page.screenshot({ path: testInfo.outputPath("md-editor-save.png"), fullPage: true });
  });

  // iterate-2026-06-04-md-editor-toolbar — the headless TipTap editor gains a
  // visible formatting toolbar. Proves the button → StarterKit command →
  // serialized-markdown consumer chain in a real browser, not just that the
  // buttons render.
  test("formatting toolbar renders and a toolbar Bold applies emphasis to the saved markdown", async ({ page }, testInfo) => {
    await mockApi(page);
    await page.goto("/preview?projectId=proj-x&path=README.md");

    await page.getByTestId("smart-viewer-edit").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();

    // Toolbar + its core buttons are present (the user's reported gap).
    await expect(page.getByTestId("md-editor-toolbar")).toBeVisible();
    await expect(page.getByTestId("md-tb-bold")).toBeVisible();
    await expect(page.getByTestId("md-tb-italic")).toBeVisible();
    await expect(page.getByTestId("md-tb-h1")).toBeVisible();

    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toContainText("Original body paragraph");

    // Select all + Bold via the toolbar button → it reflects the active state
    // and the serialized markdown gains `**` emphasis markers.
    await surface.click();
    await page.keyboard.press("ControlOrMeta+a");
    const bold = page.getByTestId("md-tb-bold");
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await expect(page.getByTestId("markdown-diff")).toContainText("**");

    await page.screenshot({ path: testInfo.outputPath("md-editor-toolbar.png"), fullPage: true });
  });

  test("409 conflict shows the banner and keeps the user's edits (AC6)", async ({ page }) => {
    await mockApi(page, { putStatus: 409 });
    await page.goto("/preview?projectId=proj-x&path=README.md");

    await page.getByTestId("smart-viewer-edit").click();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toBeVisible();
    // A real edit is required to enable Save (an unedited file round-trips
    // byte-identically now, so Save is a disabled no-op).
    await surface.click();
    await page.keyboard.type(" EDITED");
    await page.getByTestId("md-editor-review").click();
    await page.getByTestId("md-editor-save").click();

    // Conflict banner + reload action; editor (with edits) still present.
    await expect(page.getByTestId("md-editor-conflict")).toBeVisible();
    await expect(page.getByTestId("md-editor-reload")).toBeVisible();
    await expect(page.getByTestId("md-editor-surface")).toBeVisible();
    // The modal did NOT close on a conflict.
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
  });

  // Regression: iterate-2026-06-03-md-editor-frontmatter-roundtrip.
  // A YAML-frontmatter file opened and Reviewed WITHOUT any edit used to show
  // the WHOLE document as changed (frontmatter collapsed into a heading by the
  // lossy round-trip). It must now report "No changes".
  test("frontmatter file: Review with no edit reports 'No changes' (frontmatter intact)", async ({ page }, testInfo) => {
    await mockFrontmatterFile(page);
    await page.goto("/preview?projectId=proj-x&path=post.md");

    await expect(page.getByTestId("document-markdown")).toContainText("First paragraph stays put");
    await page.getByTestId("smart-viewer-edit").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();

    // Neutral "frontmatter preserved" note, NOT the lossy warn banner.
    await expect(page.getByTestId("md-editor-frontmatter-note")).toBeVisible();
    await expect(page.getByTestId("md-editor-warn")).toBeHidden();

    // Review with NO edit — the diff must report no changes.
    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await expect(page.getByTestId("markdown-diff-summary")).toHaveText("No changes");
    await expect(page.locator('[data-diff-kind="add"]')).toHaveCount(0);
    await expect(page.locator('[data-diff-kind="del"]')).toHaveCount(0);
    // Frontmatter present as context, NOT collapsed into an `## ...` heading.
    await expect(page.getByTestId("markdown-diff")).toContainText('title: "My Post"');
    await expect(page.getByTestId("markdown-diff")).not.toContainText("## title");

    await page.screenshot({ path: testInfo.outputPath("md-editor-frontmatter-nochanges.png"), fullPage: true });
  });

  test("frontmatter file: a body edit diffs only the body, and Save writes byte-correct bytes", async ({ page }) => {
    const captured = await mockFrontmatterFile(page);
    await page.goto("/preview?projectId=proj-x&path=post.md");

    await page.getByTestId("smart-viewer-edit").click();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toContainText("First paragraph stays put");
    await surface.click();
    await page.keyboard.type(" EDITED");

    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await expect(page.getByTestId("markdown-diff-summary")).not.toHaveText("No changes");
    // Exactly one line changed (AC2); frontmatter never appears as add/del/heading.
    await expect(page.locator('[data-diff-kind="add"]')).toHaveCount(1);
    await expect(page.locator('[data-diff-kind="del"]')).toHaveCount(1);
    await expect(page.locator('[data-diff-kind="add"]', { hasText: "EDITED" })).toHaveCount(1);
    await expect(page.locator('[data-diff-kind="add"]', { hasText: "title:" })).toHaveCount(0);
    await expect(page.locator('[data-diff-kind="del"]', { hasText: "title:" })).toHaveCount(0);
    await expect(page.getByTestId("markdown-diff")).not.toContainText("## title");

    // Save and assert the PUT body is byte-correct: frontmatter verbatim, the
    // edit present, NOT mangled into a heading (the latent data-loss the fix
    // closes). Proves the SAVE consumer chain, not just the diff render.
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();
    expect(captured.putBody).not.toBeNull();
    const saved = captured.putBody as string;
    const expectedFm = ["---", 'title: "My Post"', 'slug: "my-post"', 'keywords: ["a", "b"]', "---"].join(NL);
    expect(saved).toContain(expectedFm); // frontmatter verbatim
    expect(saved).toContain("EDITED");
    expect(saved).not.toContain("## title");
    expect(saved.endsWith(NL)).toBe(true); // trailing newline preserved
  });

  // Regression: iterate-2026-06-16-fix-editor-html-link-corruption.
  // Editing a content-marketing blog article that contains an inline `<a href>`
  // Shipwright link used to CORRUPT it on save — html:false entity-escaped the
  // anchor to literal `&lt;a href=…&gt;…&lt;/a&gt;` text, silently breaking the
  // link. The editor now recovers it as an equivalent markdown link.
  test("blog file: an inline <a href> Shipwright link saves as a markdown link, not corrupt &lt;a&gt; text", async ({ page }, testInfo) => {
    const captured = await mockBlogFile(page);
    await page.goto("/preview?projectId=proj-x&path=20260616/post.md");

    await expect(page.getByTestId("document-markdown")).toContainText("Shipwright");
    await page.getByTestId("smart-viewer-edit").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
    const surface = page.getByTestId("md-editor-surface");
    await expect(surface).toContainText("Built with Shipwright");

    // Raw HTML present → the lossy-construct banner nudges the user to the diff
    // (the link is normalised to markdown, not dropped).
    await expect(page.getByTestId("md-editor-warn")).toBeVisible();

    // Merely opening + saving recovers the link (the round-trip differs from the
    // on-disk HTML, so Save is enabled with no keystroke needed).
    await page.getByTestId("md-editor-review").click();
    await expect(page.getByTestId("markdown-diff")).toBeVisible();
    await page.getByTestId("md-editor-save").click();
    await expect(page.getByTestId("markdown-editor-modal")).toBeHidden();

    // The authoritative artifact: the PUT body must carry a FUNCTIONAL markdown
    // link and none of the entity-escape corruption the bug produced.
    expect(captured.putBody).not.toBeNull();
    const saved = captured.putBody as string;
    expect(saved).toContain("[Shipwright](https://github.com/svenroth-ai/shipwright)");
    expect(saved).not.toContain("&lt;");
    expect(saved).not.toContain("&gt;");
    expect(saved).not.toContain("<a "); // no leftover raw anchor tag either
    expect(saved).toContain('slug: "sdlc-automation"'); // frontmatter verbatim

    await page.screenshot({ path: testInfo.outputPath("md-editor-htmllink-recovered.png"), fullPage: true });
  });
});
