/*
 * Spec — in-page #fragment links in the SmartViewer HTML preview
 * (iterate-2026-11-18-smartviewer-html-anchor-nav, FR-01.02).
 *
 * The srcdoc carries <base target=_blank>, which made a table-of-contents link
 * (<a href="#sec2">) open a new tab instead of scrolling the page. Route-mocks the file
 * API with a long page and asserts, in real Chromium, that the click scrolls the frame
 * and opens no popup, while an external link still opens one.
 */

import { test, expect } from "@playwright/test";

const HTML = [
  "<!DOCTYPE html><html><body style='margin:0'>",
  "<nav><a id='toc' href='#sec2'>Two</a> <a id='ext' href='https://example.com/x'>Ext</a></nav>",
  "<h2 id='sec1'>One</h2><div style='height:2500px'>filler</div>",
  "<h2 id='sec2'>Two</h2><div style='height:2500px'>filler</div>",
  "</body></html>",
].join("");

// @covers FR-01.02
test.describe("SmartViewer HTML in-page anchors (FR-01.02)", () => {
  test("a #fragment link scrolls inside the preview and opens no new tab", async ({ page, context }) => {
    await page.route("**/api/external/projects/**/file**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML }),
    );
    await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, body: "ext" }));
    await page.goto("/preview?projectId=proj-x&path=report.html");

    const frame = page.frameLocator('[data-testid="smart-viewer-html-frame"]');
    await expect(frame.locator("#sec2")).toBeAttached({ timeout: 5000 });
    const before = context.pages().length;
    const inViewport = () => frame.locator("#sec2").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top > -5 && r.top < window.innerHeight; // sub-pixel tolerance at the top edge
    });
    expect(await inViewport()).toBe(false);

    await frame.locator("#toc").click();
    await expect.poll(inViewport, { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(300);
    expect(context.pages().length).toBe(before);
  });

  test("an external link still opens in a new tab", async ({ page, context }) => {
    await page.route("**/api/external/projects/**/file**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML }),
    );
    await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, body: "ext" }));
    await page.goto("/preview?projectId=proj-x&path=report.html");

    const frame = page.frameLocator('[data-testid="smart-viewer-html-frame"]');
    const popup = context.waitForEvent("page", { timeout: 5000 });
    await frame.locator("#ext").click();
    await popup;
  });
});
