/*
 * Flow J — /media video streaming (F0.5 surface=web,
 * iterate-2026-06-03-smartviewer-video-view).
 *
 * Verifies the production path that the in-memory `app.request` unit test
 * cannot: the REAL @hono/node-server adapter streaming a Range response,
 * plus the browser consumer chain (PreviewPage → SmartViewer →
 * VideoRenderer → <video src=/media>) actually fetching /media.
 *
 * Driven by run-f05-media.sh which boots an isolated single-process stack
 * (temp USERPROFILE, alt PORT, SHIPWRIGHT_STATIC_DIR=built SPA), seeds a
 * project containing a 100-byte ramp file `clip.mp4` (byte[i] === i), and
 * exports BASE_URL + PROJECT_ID.
 */

import { cleanupProject, seedProject, setActiveProject, type SeededProject } from "../helpers/fixtures";
import { API_BASE } from "../helpers/env";
import { test, expect } from "@playwright/test";

const BASE = API_BASE;
const PID = process.env.PROJECT_ID ?? "";
const RAMP_LEN = 100;

test.describe("Flow J — /media video streaming", () => {
  // A00 — this spec assumed a project already existed on the machine.
  // Without one the board renders no create-menu, no columns, no chip.
  let project: SeededProject;

  test.beforeEach(async ({ page, request }) => {
    project = await seedProject(request, { name: "70-j-media-route" });
    await setActiveProject(page, project.projectId);
  });

  test.afterEach(async ({ request }) => {
    await cleanupProject(request, project);
  });

  test("real-server Range request → 206 byte-exact slice", async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/external/projects/${PID}/media?path=clip.mp4`,
      { headers: { Range: "bytes=10-19" } },
    );
    expect(res.status()).toBe(206);
    expect(res.headers()["content-range"]).toBe(`bytes 10-19/${RAMP_LEN}`);
    expect(res.headers()["accept-ranges"]).toBe("bytes");
    const buf = await res.body();
    expect(buf.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(buf[i], `byte ${i}`).toBe(10 + i);
    }
  });

  test("full GET → 200 + Accept-Ranges + video/mp4", async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/external/projects/${PID}/media?path=clip.mp4`,
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("video/mp4");
    expect(res.headers()["accept-ranges"]).toBe("bytes");
  });

  test("non-video extension → 415", async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/external/projects/${PID}/media?path=README.md`,
    );
    expect(res.status()).toBe(415);
  });

  test("browser: SmartViewer mounts VideoRenderer and fetches /media", async ({
    page,
  }) => {
    const mediaStatuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/media?path=")) mediaStatuses.push(r.status());
    });
    await page.goto(`${BASE}/preview?projectId=${PID}&path=clip.mp4`);

    // VideoRenderer rendered — the <video> element, or (for a non-decodable
    // synthetic clip) its onError fallback chip. Either proves the SmartViewer
    // video dispatch reached VideoRenderer (codec-independent assertion).
    const rendered = page.locator(
      '[data-testid="smart-viewer-video"], [data-testid="smart-viewer-video-error"]',
    );
    await expect(rendered.first()).toBeVisible({ timeout: 10_000 });

    // The <video src=/media> caused at least one real network fetch.
    await expect
      .poll(() => mediaStatuses.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect(
      mediaStatuses.every((s) => s === 200 || s === 206),
      `all /media responses must be 200/206, got ${mediaStatuses.join(",")}`,
    ).toBe(true);
  });
});
