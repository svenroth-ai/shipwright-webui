/*
 * Spec 97 — a keystroke revives a terminal whose socket went silent during a
 * Mac lock/sleep (iterate-2026-07-27-mac-terminal-fast-dead-socket).
 *
 * Confirmed with the reporter: on macOS the page keeps running during a
 * lock/sleep (no JS freeze → the clock-drift wake detector never fires) and no
 * focus/visibility/online event fires on return, but the WS dies silently. The
 * reliable macOS signal is that the returning user INTERACTS — a keystroke/click
 * fires a DOM event regardless of OS-wake behaviour — so an interaction now
 * drives an eager revive when the socket has been inbound-silent long enough to
 * be suspect.
 *
 * Real Chromium, real xterm, real wsLiveness. `routeWebSocket` fully mocks the
 * socket (no pty needed) and can go half-open: it stops answering pings without
 * closing — exactly the state a slept-through socket is left in. `page.clock`
 * makes the connection go inbound-silent (stale) deterministically. The eager
 * revive is observed at the mock as an out-of-band probe ping that appears the
 * instant the user types — with NO focus/visibility/online event.
 *
 * The interaction→reconnect path (socket already gone) is covered by the unit
 * suite (wsLiveness.interaction.test.ts); this proves the trigger fires in a
 * real browser end-to-end.
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
    data: { title: "terminal-interaction-spec-97", cwd },
  });
  if (!res.ok()) throw new Error(`create task: HTTP ${res.status()}`);
  const body = (await res.json()) as { task: { taskId: string } };
  return body.task.taskId;
}

const READY = JSON.stringify({
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
});

test.describe("Embedded terminal — a keystroke revives a silent socket", () => {
  test("typing on an inbound-silent socket fires an eager probe (no wake event)", async ({
    page,
    request,
  }) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-interaction-e2e-"));
    const taskId = await createTask(request, cwd);

    let answerPings = true;
    let pings = 0;

    await page.clock.install();
    await page.routeWebSocket(/\/api\/terminal\/.*\/ws/, (ws) => {
      ws.send(READY);
      ws.onMessage((raw) => {
        let m: { type?: string };
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (m.type === "ping") {
          pings += 1;
          if (answerPings) ws.send(JSON.stringify({ type: "pong" }));
        }
      });
    });

    try {
      await page.goto(`/tasks/${taskId}`);
      const terminal = page.getByTestId("embedded-terminal");
      await expect(terminal).toBeVisible();
      await expect(terminal).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });

      // ── Lock/sleep: the peer goes silent but the socket stays OPEN (half-open).
      answerPings = false;
      // Advance past the stale window. fastForward fires the heartbeat AT MOST
      // ONCE (one unanswered ping, not the 2 needed to reap), so the socket stays
      // OPEN — but the connection is now inbound-silent, and the clock is frozen
      // so nothing else fires on its own from here.
      await page.clock.fastForward(12_000);
      await expect(terminal).toHaveAttribute("data-ws-ready", "true"); // still open, just silent

      const pingsBeforeType = pings;
      // The user returns and types. No focus/visibility/online event fires.
      await page.getByTestId("embedded-terminal-canvas").click();
      await page.keyboard.press("a");

      // THE assertion: the keystroke drove an eager probe — a ping the client
      // would not otherwise send (the heartbeat is frozen). Disabling the
      // interaction trigger leaves this at 0 and the test times out.
      await expect.poll(() => pings - pingsBeforeType, { timeout: 8_000 }).toBeGreaterThan(0);
    } finally {
      await request.delete(`/api/external/tasks/${taskId}`).catch(() => {});
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
