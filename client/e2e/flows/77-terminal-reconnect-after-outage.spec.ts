/*
 * Spec 77 — the embedded terminal never stops trying to reconnect
 * (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * The reported bug: after a Mac sleep/resume the terminal was frozen — no
 * output, no scrolling — until the browser tab was refreshed. Root cause: the
 * reconnect scheduler used a hard 5-attempt / ~6.2 s budget, spent it entirely
 * against a tunnel that had not finished re-establishing, and then went
 * PERMANENTLY inert (zero armed timers), so it could never notice the network
 * coming back.
 *
 * A real OS suspend cannot be driven from Playwright, but the property that
 * actually regressed can be observed directly in a real browser: DOES THE
 * CLIENT KEEP TRYING once the fast ramp is spent? Playwright reports every
 * WebSocket the page creates, so the attempt count IS the regression signal:
 *
 *   old code → the count freezes at 6 (1 initial + 5 ramp) and never moves;
 *   fixed    → it keeps climbing on the retry tail, indefinitely.
 *
 * The outage is produced by pointing the task at a cwd the server cannot spawn
 * a pty in, so every WS upgrade is rejected. From the client that is
 * indistinguishable from an unreachable server — and it doubles as the
 * "permanently refused attach" case that motivated the slow-tail backoff.
 *
 * Covers AC-1 (never inert), AC-5 (visible as reconnecting, not frozen) and
 * AC-6 (calm cadence, not a hot loop). The recovery-to-ready leg needs a live
 * pty and is covered by the unit suites (useTerminalSocket.osresume.test.ts).
 */

import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function createTask(
  request: import("@playwright/test").APIRequestContext,
  cwd: string,
) {
  const res = await request.post("/api/external/tasks", {
    data: { title: "terminal-reconnect-spec-77", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("Embedded terminal — the reconnect schedule never goes inert", () => {
  test("keeps retrying long after the old 5-attempt budget would have given up", async ({
    page,
    request,
  }) => {
    test.slow(); // deliberately spends >30 s observing the retry tail
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-reconnect-e2e-"));
    const taskId = await createTask(request, cwd);

    // Count every terminal WS the page opens — one per reconnect attempt.
    const attempts: number[] = [];
    page.on("websocket", (ws) => {
      if (ws.url().includes("/api/terminal/")) attempts.push(Date.now());
    });

    try {
      await page.goto(`/tasks/${taskId}`);
      await expect(page.getByTestId("embedded-terminal")).toBeVisible();

      // AC-5 — the outage surfaces as "reconnecting", not as a frozen pane.
      const banner = page.getByTestId("embedded-terminal-reconnecting");
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner).toContainText(/reconnecting/i);

      // The fast ramp is spent by now (1 initial + 5 ramp ≈ 6.2 s).
      await expect
        .poll(() => attempts.length, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(6);
      const afterRamp = attempts.length;

      // ── THE regression assertion ────────────────────────────────────────
      // Old code: permanently inert here, so this count would never move again
      // and the terminal stayed dead until a tab reload.
      await expect
        .poll(() => attempts.length, { timeout: 30_000 })
        .toBeGreaterThan(afterRamp);

      // AC-6 — a calm cadence, not a 200 ms hot loop. Well under one attempt
      // per second averaged over the whole observation window.
      const elapsedS = (attempts[attempts.length - 1] - attempts[0]) / 1000;
      expect(attempts.length / Math.max(elapsedS, 1)).toBeLessThan(1);

      // Still telling the user it is working on it.
      await expect(banner).toBeVisible();
    } finally {
      await request.delete(`/api/external/tasks/${taskId}`).catch(() => {});
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
