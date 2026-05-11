/*
 * v0.9.2 — EmbeddedTerminal mount-race regression fence (ADR-084).
 *
 * Replaces the diagnostic spec `_v091-debug-resume.spec.ts` that surfaced the
 * two bugs we close here:
 *
 *   AC-1: Transient "Read only" banner during React.StrictMode dev
 *         double-mount + early `role=reader` window before `writer-promoted`
 *         arrives. Fix: 1500 ms grace window anchored on the rising edge of
 *         `socket.ready`.
 *
 *   AC-2: Uncaught pageerror "Cannot read properties of undefined
 *         (reading 'dimensions')" — xterm-addon-fit's
 *         `_renderService.dimensions` accessed by an async tail after
 *         `term.dispose()` (or before `term.open()` populated the
 *         renderer). Fix: `safeFit` helper + `disposedRef` cleanup ordering.
 *
 * Runs against the live Hono+Vite dev stack on the Tailscale interface via
 * `playwright.tailscale.config.ts`. No `webServer` auto-start — assumes the
 * stack is already up (Hono on :3847 + Vite on :5173 with HONO_HOST=true OR
 * SHIPWRIGHT_NETWORK_PROFILE=tailscale).
 *
 * The target task `31b4076d-5a0a-4c62-b176-63553c165c03` has substantial
 * persisted scrollback (~82 KB), so the replay path is exercised on every
 * navigate — that's the exact code path where the `dimensions` pageerror
 * surfaced in the v0.9.1-post repro.
 */

import { test, expect, type WebSocket as PWWebSocket } from "@playwright/test";

const TASK_ID = "31b4076d-5a0a-4c62-b176-63553c165c03";

// Sample the read-only banner at 100 ms intervals across the 1500 ms grace
// window so a transient flash (e.g. <100 ms during StrictMode mount-1 → mount-2
// → writer-promoted) is caught. A single `expect.toBeHidden({timeout:1400})`
// could miss the flash depending on Playwright's poll cadence.
const GRACE_WINDOW_MS = 1500;
const SAMPLE_INTERVAL_MS = 100;
const SAMPLE_COUNT = Math.ceil(GRACE_WINDOW_MS / SAMPLE_INTERVAL_MS); // 15

test.describe("v0.9.2 — EmbeddedTerminal mount-race regression", () => {
  test("AC-1: no transient readonly banner across the 1500ms grace window", async ({ page }) => {
    test.setTimeout(30_000);

    const pageErrors: { msg: string; stack: string }[] = [];
    page.on("pageerror", (err) =>
      pageErrors.push({ msg: err.message, stack: err.stack ?? "" }),
    );

    // Per external code review openai #4: anchor the sampling window on
    // the actual ready envelope (not just DOM container attach), so a
    // slow ready doesn't let the test pass while missing a banner flash
    // in the true post-ready grace window. We hook page.on("websocket")
    // and resolve `readyArrivedAt` the first time a frame matching the
    // ready envelope shape arrives on a /api/terminal/<id>/ws socket.
    let readyArrivedAt = 0;
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/api/terminal/")) return;
      ws.on("framereceived", (frame) => {
        if (readyArrivedAt > 0) return;
        if (typeof frame.payload !== "string") return;
        if (frame.payload.startsWith('{"type":"ready"')) {
          readyArrivedAt = Date.now();
        }
      });
    });

    await page.goto(`/tasks/${TASK_ID}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const terminalTab = page.getByRole("tab", { name: /terminal/i });
    if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await terminalTab.click();
    }

    // Wait for the EmbeddedTerminal container to be in the DOM.
    await page
      .locator('[data-testid="embedded-terminal"]')
      .waitFor({ state: "attached", timeout: 10_000 });

    // Wait for the ready envelope to arrive (poll-loop up to 5s). On the
    // local Tailscale stack this typically fires <300ms after navigate.
    const readyWaitStart = Date.now();
    while (readyArrivedAt === 0 && Date.now() - readyWaitStart < 5_000) {
      await page.waitForTimeout(50);
    }
    expect(
      readyArrivedAt,
      "ready envelope did not arrive within 5s — stack down?",
    ).toBeGreaterThan(0);

    const samples: { tMs: number; bannerPresent: boolean }[] = [];
    const startedAt = readyArrivedAt; // anchor at ready envelope, not navigate
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const present = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="embedded-terminal-readonly"]',
        );
        if (!el) return false;
        // visible = element exists AND has non-zero bounding box AND is not
        // CSS-hidden via display:none / visibility:hidden / opacity:0.
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const cs = window.getComputedStyle(el as HTMLElement);
        if (cs.display === "none") return false;
        if (cs.visibility === "hidden") return false;
        if (parseFloat(cs.opacity) === 0) return false;
        return true;
      });
      samples.push({ tMs: Date.now() - startedAt, bannerPresent: present });
      if (i < SAMPLE_COUNT - 1) {
        await page.waitForTimeout(SAMPLE_INTERVAL_MS);
      }
    }

    const flashes = samples.filter((s) => s.bannerPresent);
    if (flashes.length > 0) {
      // Helpful diagnostic — captures the exact tMs where the flash occurred
      // so a regression run can pinpoint how long the banner was visible.
      // eslint-disable-next-line no-console
      console.log(
        "AC-1 FAIL — banner flashed at:",
        JSON.stringify(flashes, null, 2),
      );
    }
    expect(flashes).toEqual([]);

    // Also verify no dimensions pageerror surfaced (AC-2 belt-and-braces from
    // this navigate — full AC-2 coverage is in the dedicated test below).
    const dimensionsErrors = pageErrors.filter((e) =>
      /dimensions|_renderService/.test(e.msg),
    );
    expect(dimensionsErrors).toEqual([]);
  });

  test("AC-2: no dimensions pageerror during mount + replay + resume click", async ({ page }) => {
    test.setTimeout(45_000);

    const pageErrors: { msg: string; stack: string }[] = [];
    page.on("pageerror", (err) =>
      pageErrors.push({ msg: err.message, stack: err.stack ?? "" }),
    );

    // WS frame capture — helpful diagnostic on failure (verbatim pattern from
    // the v0.9.1 debug spec it replaces).
    const wsLog: {
      url: string;
      framesReceived: number;
      framesSent: number;
    }[] = [];
    page.on("websocket", (ws: PWWebSocket) => {
      const entry = { url: ws.url(), framesReceived: 0, framesSent: 0 };
      wsLog.push(entry);
      ws.on("framereceived", () => {
        entry.framesReceived += 1;
      });
      ws.on("framesent", () => {
        entry.framesSent += 1;
      });
    });

    await page.goto(`/tasks/${TASK_ID}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const terminalTab = page.getByRole("tab", { name: /terminal/i });
    if (await terminalTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await terminalTab.click();
    }

    // Phase 1: wait for replay to flush (mount + ready + scrollback-meta +
    // replay_start + chunks + replay_separator + replay_end + first live
    // data). The v0.9.1 debug spec observed all of these in <100 ms over
    // Tailscale but the dimensions error sometimes surfaced async right at
    // the end. Wait 5s to give any straggler async tail time to fire.
    await page.waitForTimeout(5_000);

    // Phase 2: click Resume if visible (exercises the auto-launch WS data
    // frame injection + the post-injection resize / re-render path).
    const resumeBtn = page.getByRole("button", { name: /resume|launch/i });
    if (await resumeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await resumeBtn.click();
      await page.waitForTimeout(3_000);
    }

    const dimensionsErrors = pageErrors.filter((e) =>
      /dimensions|_renderService/.test(e.msg),
    );
    if (dimensionsErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        "AC-2 FAIL — dimensions pageerrors captured:",
        JSON.stringify({ pageErrors, wsLog }, null, 2),
      );
    }
    expect(dimensionsErrors).toEqual([]);

    // Sanity: ALL pageerrors that fired are listed in the test output for
    // forensic value, even if no `dimensions` match was found.
    if (pageErrors.length > 0 && dimensionsErrors.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        "AC-2 OK — other pageerrors observed (not dimensions-related):",
        pageErrors,
      );
    }
  });
});
