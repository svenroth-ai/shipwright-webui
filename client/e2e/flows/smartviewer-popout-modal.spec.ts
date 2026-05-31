/*
 * Spec — SmartViewer pop-out modal
 * (iterate-2026-05-31-smartviewer-popout-modal).
 *
 * The pop-out button used to open `/preview` in a NEW BROWSER TAB
 * (window.open). It now opens a centered in-app Radix Dialog modal instead.
 * This spec drives the real `/preview` SmartViewer host (route-mocking the
 * file API) and asserts:
 *   - clicking pop-out opens a viewport-centered modal (portal-to-body),
 *   - the modal body renders a nested SmartViewer (document-markdown),
 *   - the nested SmartViewer shows NO further pop-out button,
 *   - ESC closes the modal, and the close X closes it too,
 *   - window.open is never called (no new tab).
 */

import { test, expect, type Page } from "@playwright/test";

const DOC = ["# Architecture", "", "Some preview body text.", ""].join("\n");

async function mockFile(page: Page) {
  await page.route("**/api/external/projects/**/file**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      body: DOC,
    }),
  );
  // Trap any accidental new-tab pop-out regression.
  await page.addInitScript(() => {
    (window as unknown as { __openCalls: number }).__openCalls = 0;
    const orig = window.open.bind(window);
    window.open = ((...args: unknown[]) => {
      (window as unknown as { __openCalls: number }).__openCalls += 1;
      return orig(...(args as Parameters<typeof window.open>));
    }) as typeof window.open;
  });
}

test.describe("SmartViewer pop-out modal", () => {
  test("opens a centered modal, suppresses nested pop-out, ESC + X close it, no new tab", async ({
    page,
  }, testInfo) => {
    await mockFile(page);
    await page.goto("/preview?projectId=proj-x&path=architecture.md");

    // Host SmartViewer is up.
    await expect(page.getByTestId("document-markdown").first()).toBeVisible({
      timeout: 8000,
    });

    const popout = page.getByTestId("smart-viewer-popout");
    await expect(popout).toBeVisible();

    // --- open the modal -----------------------------------------------------
    await popout.click();
    const modal = page.getByTestId("smart-viewer-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Header shows the file path.
    await expect(page.getByTestId("smart-viewer-modal-path")).toContainText(
      "architecture.md",
    );

    // Body renders a nested SmartViewer (its own document-markdown).
    await expect(modal.getByTestId("document-markdown")).toBeVisible();

    // Nested pop-out is suppressed inside the modal.
    await expect(modal.getByTestId("smart-viewer-popout")).toHaveCount(0);

    // Viewport-centered (portal to body, not anchored to the pane): the modal's
    // center is close to the viewport center on both axes.
    const box = await modal.boundingBox();
    const vw = page.viewportSize();
    expect(box).not.toBeNull();
    expect(vw).not.toBeNull();
    if (box && vw) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      expect(Math.abs(cx - vw.width / 2)).toBeLessThan(8);
      expect(Math.abs(cy - vw.height / 2)).toBeLessThan(8);
      // 90vh tall (allow a small rounding margin).
      expect(box.height).toBeGreaterThan(vw.height * 0.85);
    }

    await page.screenshot({
      path: testInfo.outputPath("smartviewer-popout-modal-open.png"),
      fullPage: true,
    });

    // --- ESC closes ---------------------------------------------------------
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden({ timeout: 3000 });

    // --- re-open, then close via the X --------------------------------------
    await popout.click();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.getByTestId("smart-viewer-modal-close").click();
    await expect(modal).toBeHidden({ timeout: 3000 });

    // No new browser tab was ever opened.
    const openCalls = await page.evaluate(
      () => (window as unknown as { __openCalls: number }).__openCalls,
    );
    expect(openCalls).toBe(0);
  });
});
