/*
 * Spec — SmartViewer renders .html in a sandboxed iframe
 * (iterate-2026-10-23-terminal-smartviewer-html-view, FR-01.02).
 *
 * Route-mocks the file API with a page whose inline script (a) writes into the
 * DOM — proving scripts run — and (b) tries to fetch the webui API — proving the
 * CSP + opaque origin block it. Asserts in real Chromium via frameLocator.
 */

import { test, expect } from "@playwright/test";

const HTML = [
  "<!DOCTYPE html><html><body>",
  "<h1 id='t'>Board</h1><p id='s'>script-not-run</p><p id='f'>fetch-pending</p>",
  "<script>",
  "document.getElementById('s').textContent='script-ran';",
  "fetch('/api/external/projects').then(function(){document.getElementById('f').textContent='fetch-allowed'}).catch(function(){document.getElementById('f').textContent='fetch-blocked'});",
  "</script></body></html>",
].join("");

// @covers FR-01.02
test.describe("SmartViewer HTML rendering (FR-01.02)", () => {
  test("renders html in a sandbox: scripts run, network is blocked, Source toggles", async ({ page }) => {
    await page.route("**/api/external/projects/**/file**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML }),
    );
    await page.goto("/preview?projectId=proj-x&path=board.html");

    const frame = page.frameLocator('[data-testid="smart-viewer-html-frame"]');
    await expect(frame.locator("#t")).toHaveText("Board", { timeout: 5000 });
    await expect(frame.locator("#s")).toHaveText("script-ran");
    await expect(frame.locator("#f")).toHaveText("fetch-blocked");

    await page.getByTestId("smart-viewer-html-source").click();
    await expect(page.getByTestId("smart-viewer-html-frame")).toHaveCount(0);
    await expect(page.getByTestId("smart-viewer-html")).toContainText("<h1");
  });
});
