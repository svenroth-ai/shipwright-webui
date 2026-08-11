/*
 * Spec — Terminal WS liveness heartbeat: a HEALTHY tab is not reaped
 * ==================================================================
 *
 * iterate-2026-05-31-terminal-readonly-keepalive AC-5 (web surface).
 *
 * The fix adds a per-connection WS ping/pong heartbeat that terminate()s a
 * DEAD socket so a stale writer slot can't pin the "Read-only — another tab
 * is the active writer" banner. This spec proves the OTHER half: a healthy,
 * foregrounded tab — whose browser auto-pongs at the protocol layer — must
 * NOT be reaped, even after several heartbeat intervals have elapsed.
 *
 * Stack contract: booted with `SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS=3000`
 * (see the iterate spec F0.5 invocation). With the default 2-miss tolerance
 * a DEAD socket is reaped at ~6 s (ping t0 → ping t3 → terminate t6); we
 * wait past that deadline and assert the live socket survived, so the test
 * genuinely exercises the heartbeat rather than passing vacuously.
 *
 * Isolated prod stack (memory feedback_iterate_e2e_isolated_userprofile +
 * feedback_dev_vs_autostart_port_conflict): USERPROFILE/HOME = tmp dir,
 * SHIPWRIGHT_NETWORK_PROFILE=local, run against BASE_URL=http://127.0.0.1:4847.
 */

import { test, expect } from "@playwright/test";

import {
  attachWsCapture,
  isTerminalSocket,
} from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

/** Matches the stack's SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS for this run. */
const HEARTBEAT_MS = 3000;
/** Wait past the dead-socket reap deadline (~2 intervals + slack). */
const SURVIVE_MS = HEARTBEAT_MS * 3 + 1000;

test.describe("terminal WS liveness heartbeat", () => {
  test.setTimeout(60_000);

  test("a healthy terminal WS is not reaped across multiple heartbeat intervals", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("hb-smoke-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `hb-smoke-${Date.now()}`);

      const cap = attachWsCapture(page);
      await page.goto(`/tasks/${taskId}`);

      // The terminal pane is forceMount'd, so its WS attaches on load.
      const root = page.getByTestId("embedded-terminal");
      await expect(root).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });
      const initialSockets = cap.frames.filter(
        (f) => f.kind === "open" && isTerminalSocket(f.url, taskId),
      );
      expect(initialSockets.length, "terminal socket opened").toBeGreaterThan(0);
      const termSocketId = initialSockets.at(-1)!.socketId;

      // Hold the (healthy) tab open past the dead-socket reap deadline.
      await page.waitForTimeout(SURVIVE_MS);

      // 1) The terminal socket that delivered ready{writer} was NOT closed —
      //    the heartbeat did not falsely reap a ponging connection.
      const wasClosed = cap.frames.some(
        (f) => f.kind === "close" && f.socketId === termSocketId,
      );
      expect(
        wasClosed,
        "terminal WS must NOT be closed by the heartbeat (a healthy tab auto-pongs)",
      ).toBe(false);

      // 2) No reap→reconnect churn: exactly one terminal WS opened.
      const termOpens = cap.frames.filter(
        (f) => f.kind === "open" && isTerminalSocket(f.url, taskId),
      );
      // React StrictMode can establish one disposable mount socket.  The
      // heartbeat fence is that it does not keep reconnecting thereafter.
      expect(termOpens.length, "no reap→reconnect churn").toBeLessThanOrEqual(2);

      // 3) The pane still reports a live writer and shows no read-only banner.
      await expect(root).toHaveAttribute("data-ws-ready", "true");
      await expect(root).toHaveAttribute("data-role", "writer");
      await expect(page.getByTestId("embedded-terminal-readonly")).toHaveCount(0);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
