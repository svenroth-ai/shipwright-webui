/*
 * Spec 78 — the terminal recovers from an OS sleep even when NO browser event
 * fires (iterate-2026-07-23-mac-wake-terminal-revive).
 *
 * The Mac-only defect: after lid-close → unlock, macOS fires none of the events
 * the eager reconnect relies on (focus / pageshow / visibilitychange / online),
 * so recovery fell to the slow ~45 s heartbeat and the terminal sat frozen until
 * a manual reload. The fix is a clock-drift wake detector.
 *
 * This exercises the real wake detector in a real Chromium:
 *   - `page.clock` — Playwright documents `fastForward` as "the user closing the
 *     laptop lid and reopening it later." Exactly the freeze/resume we need, and
 *     the ONLY signal delivered (no focus/visibility/online is dispatched).
 *   - `routeWebSocket` fully MOCKS the terminal socket (no server pty needed),
 *     and — crucially — can go HALF-OPEN: stop answering pings without closing,
 *     which is precisely the state a slept-through socket is left in and which
 *     nothing else can reproduce.
 *
 * If the wake detector regresses, no reconnect is attempted after the lid-close
 * simulation and this fails.
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
    data: { title: "terminal-wake-spec-78", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

test.describe("Embedded terminal — wake detector recovers a slept-through socket", () => {
  test("a lid-close simulation reconnects with NO focus/visibility/online event", async ({
    page,
    request,
  }) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-wake-e2e-"));
    const taskId = await createTask(request, cwd);

    // Test-controlled socket. `answerPings` off = the half-open state a sleep
    // leaves behind (OPEN, but the peer is silently gone).
    let answerPings = true;
    let attaches = 0;

    await page.clock.install();
    await page.routeWebSocket(/\/api\/terminal\/.*\/ws/, (ws) => {
      attaches += 1;
      ws.send(
        JSON.stringify({
          type: "ready",
          role: "writer",
          shellKind: "posix",
          cwd: "/x",
          replayOnly: false,
          scrollbackBytes: 0,
          retentionDays: 7,
          scrollbackDir: "/tmp",
          terminalReset: false,
          ptyReused: false,
        }),
      );
      ws.onMessage((raw) => {
        let m: { type?: string };
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.type === "ping" && answerPings) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      });
    });

    try {
      await page.goto(`/tasks/${taskId}`);
      const terminal = page.getByTestId("embedded-terminal");
      await expect(terminal).toBeVisible();
      await expect(terminal).toHaveAttribute("data-ws-ready", "true", {
        timeout: 30_000,
      });
      expect(attaches).toBe(1);

      // ── The lid closes and the machine sleeps ──
      // The socket goes half-open: still OPEN to the browser, but the peer is
      // gone, so pings will never be answered.
      answerPings = false;

      // Simulate the sleep: the wall clock jumps far past the wake threshold
      // while the page was frozen. This is the ONLY signal — no focus,
      // visibility or online event is dispatched anywhere.
      await page.clock.fastForward(20_000);
      // Let the eager probe's deadline (4 s) and the first reconnect backoff
      // elapse: probe unanswered → close → reconnect.
      await page.clock.runFor(6_000);

      // THE assertion: a reconnect was attempted, driven purely by the clock
      // jump. Before the wake detector, `attaches` would stay 1 here and the
      // terminal would sit frozen until the ~45 s heartbeat (or a reload).
      await expect
        .poll(() => attaches, { timeout: 15_000 })
        .toBeGreaterThan(1);

      // And with the peer answering again, it settles back to ready on its own.
      answerPings = true;
      await page.clock.runFor(6_000);
      await expect(terminal).toHaveAttribute("data-ws-ready", "true", {
        timeout: 15_000,
      });
    } finally {
      await request.delete(`/api/external/tasks/${taskId}`).catch(() => {});
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
