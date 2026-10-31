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
  // @covers FR-01.02
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
    // Hanging indent: the long line starts flush, its wrapped rows sit ~2ch further right.
    const lefts = await code.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const byTop = new Map<number, number>();
      for (const q of Array.from(r.getClientRects())) {
        if (q.width === 0) continue;
        const t = Math.round(q.top);
        byTop.set(t, Math.min(byTop.get(t) ?? Infinity, q.left));
      }
      const ch = parseFloat(getComputedStyle(el).fontSize) * 0.6;
      return { rows: [...byTop.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), ch };
    });
    expect(lefts.rows[2] - lefts.rows[1]).toBeGreaterThan(lefts.ch);
    expect(Math.abs(lefts.rows[1] - lefts.rows[0])).toBeLessThan(2);
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

  // @covers FR-01.02
  test("plain text: wraps by default with the same shared toggle, number on the first row only, hanging indent", async ({ page }) => {
    const TXT = ["short line", LONG, "last line"].join(String.fromCharCode(10));
    await page.route("**/api/external/projects/**/file**", (route) =>
      route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: TXT }),
    );
    await page.goto("/preview?projectId=proj-x&path=notes.txt");
    const pre = page.getByTestId("smart-viewer-text");
    await expect(pre).toBeVisible({ timeout: 5000 });
    const host = page.getByTestId("smart-viewer-text-host");
    const toggle = page.getByRole("button", { name: "Wrap lines" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await host.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const line2 = pre.locator(".sv-text-line").nth(1);
    const m = await line2.evaluate((el) => {
      const body = el.querySelector(".sv-text-body") as HTMLElement;
      const ln = el.querySelector(".sv-text-ln") as HTMLElement;
      const cs = getComputedStyle(body);
      const lh = parseFloat(cs.lineHeight);
      const r = document.createRange();
      r.selectNodeContents(body);
      const byTop = new Map<number, number>();
      for (const q of Array.from(r.getClientRects())) {
        if (q.width === 0) continue;
        const t = Math.round(q.top);
        byTop.set(t, Math.min(byTop.get(t) ?? Infinity, q.left));
      }
      const rows = [...byTop.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      return { fs: cs.fontSize, lh, rows, bodyH: body.getBoundingClientRect().height, lnH: ln.getBoundingClientRect().height, lnTop: ln.getBoundingClientRect().top - body.getBoundingClientRect().top };
    });
    expect(m.fs).toBe("13px");
    expect(m.lh).toBeCloseTo(20.8, 1);
    expect(m.bodyH / m.lh).toBeGreaterThan(3); // wrapped over several visual rows
    expect(m.lnH).toBeLessThanOrEqual(m.lh + 1); // the number occupies the first visual row only
    expect(Math.abs(m.lnTop)).toBeLessThan(2);
    expect(m.rows[1] - m.rows[0]).toBeGreaterThan(8); // continuation rows hang to the right

    // Toggle off: raw, scrolls sideways; the preference is shared with the code view (same key).
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => host.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => window.localStorage.getItem("shipwright:viewer-wrap-lines"))).toBe("false");
  });
});
