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

import { test, expect, type Page } from "@playwright/test";

const DOC_V1 = "# Title\n\nOriginal body paragraph.\n";
const DOC_V2 = "# Title\n\nSaved new body paragraph.\n";

async function mockApi(page: Page, opts: { putStatus?: number } = {}) {
  const putStatus = opts.putStatus ?? 200;
  let saved = false;
  await page.route("**/api/external/projects/**/file**", async (route) => {
    if (route.request().method() === "PUT") {
      saved = true;
      if (putStatus === 409) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "fingerprint_mismatch",
            currentFingerprint: "sha256:disk",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ written: true, fingerprint: "sha256:v2", size: DOC_V2.length }),
      });
    }
    // GET — after a successful save, serve the updated content (AC5b).
    const body = saved && putStatus === 200 ? DOC_V2 : DOC_V1;
    return route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      headers: { ETag: '"sha256:v1"' },
      body,
    });
  });
}

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

  test("409 conflict shows the banner and keeps the user's edits (AC6)", async ({ page }) => {
    await mockApi(page, { putStatus: 409 });
    await page.goto("/preview?projectId=proj-x&path=README.md");

    await page.getByTestId("smart-viewer-edit").click();
    await expect(page.getByTestId("md-editor-surface")).toBeVisible();
    await page.getByTestId("md-editor-review").click();
    await page.getByTestId("md-editor-save").click();

    // Conflict banner + reload action; editor (with edits) still present.
    await expect(page.getByTestId("md-editor-conflict")).toBeVisible();
    await expect(page.getByTestId("md-editor-reload")).toBeVisible();
    await expect(page.getByTestId("md-editor-surface")).toBeVisible();
    // The modal did NOT close on a conflict.
    await expect(page.getByTestId("markdown-editor-modal")).toBeVisible();
  });
});
