/*
 * Spec — SmartViewer code: wrap lines by default + toggle + 13px/1.6 (V7).
 * Real Chromium via the /preview pop-out host with a route-mocked .ts file.
 */
import { test, expect, type Page } from "@playwright/test";

const LONG = "const veryLong = " + Array.from({ length: 40 }, (_, i) => `"segment_${i}"`).join(" + ") + ";";
const SRC = ["export function a() {", `  ${LONG}`, "  return veryLong;", "}"].join("\n");

async function open(page: Page) {
  await page.route("**/api/external/projects/**/file**", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: SRC }),
  );
  await page.goto("/preview?projectId=proj-x&path=src/demo.ts");
  await expect(page.getByTestId("smart-viewer-code")).toBeVisible({ timeout: 5000 });
}

test.describe("SmartViewer code wrap (V7)", () => {
  // @covers FR-01.35
  test("wraps by default, toggles to raw scroll, remembers choice, 13px/1.6", async ({ page }) => {
    await open(page);
    const pane = page.getByTestId("smart-viewer-code");
    const toggle = page.getByRole("button", { name: "Wrap lines" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Wrapped: no horizontal overflow, text wraps, 13px / 1.6.
    expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const code = pane.locator("pre code");
    const cs = await code.evaluate((el) => {
      const s = getComputedStyle(el);
      return { fs: s.fontSize, lh: s.lineHeight, ws: s.whiteSpace };
    });
    expect(cs.fs).toBe("13px");
    expect(parseFloat(cs.lh)).toBeCloseTo(20.8, 1);
    expect(cs.ws).toBe("pre-wrap");
    // The long logical line really occupies several visual rows (not clipped).
    const rows = await code.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(rows).toBeGreaterThan(4 + 2);
    // Viewer stays dark.
    expect(await code.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(13, 17, 23)");

    // Off: raw form with horizontal scroll.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => pane.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // Toggle stays reachable after scrolling the raw code sideways.
    await pane.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await expect(toggle).toBeInViewport();

    // Remembered across reload.
    await page.reload();
    await expect(page.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "false");
  });
});
