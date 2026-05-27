/*
 * Spec — fix-pty-reused-prewarm-race
 *
 * Production regression fence for iterate-2026-05-27-fix-pty-reused-prewarm-race.
 *
 * BEFORE this fix: clicking Launch IMMEDIATELY after page.goto raced
 * `prewarmPty` (`POST /api/terminal/<id>/spawn`) against the lazy-
 * mounted EmbeddedTerminal's WS upgrade. If prewarm won, the WS
 * upgrade saw a pre-existing pty → emitted `ready{ptyReused:true}`
 * → `useAutoLaunch` armed the one-shot guard → Launch parked behind
 * a manual-send confirm dialog.
 *
 * AFTER this fix: `ptyReused` is driven by `hadPriorWriter` (atomic
 * snapshot inside `pty-manager.attach()`), not by entry-existence.
 * The first WS attach to a prewarmed-only pty correctly sees
 * `hadPriorWriter:false` → `ptyReused:false` → guard does NOT arm →
 * auto-execute fires.
 *
 * Asserts BOTH positive AND negative signals (external review
 * openai #6 medium): the `claude --session-id …\r` data-frame is
 * sent on the terminal WS AND the manual-send confirm UI does NOT
 * appear.
 *
 * Runs against an isolated production-build stack (PORT=4847, temp
 * USERPROFILE) — same contract as PR #73's C5-split smoke spec.
 */

import { test, expect } from "@playwright/test";

import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  type CapturedFrame,
} from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

/** Window for the positive assertion — auto-execute should fire well
 *  inside this. The handshake constant is 250 ms quiesce. */
const AUTO_EXECUTE_WINDOW_MS = 8_000;

function launchSendForTask(taskId: string, afterMs: number) {
  return (
    f: CapturedFrame,
    env: Record<string, unknown> | null,
  ): boolean => {
    if (f.kind !== "tx") return false;
    if (env?.type !== "data") return false;
    if (f.ts < afterMs) return false;
    const payload = (env as { payload?: unknown }).payload;
    if (typeof payload !== "string") return false;
    if (!payload.includes("claude --session-id")) return false;
    // Resolve socketId → url via the capture sockets map at call site.
    return true;
  };
}

test.describe("fix-pty-reused-prewarm-race — production smoke", () => {
  test.setTimeout(60_000);

  test("click Launch IMMEDIATELY after navigation: auto-execute fires (no manual-send park)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("prewarm-race-");
    let taskId = "";
    try {
      taskId = await createTask(
        request,
        cwd,
        `prewarm-race-smoke-${Date.now()}`,
      );

      const cap = attachWsCapture(page);

      // Navigate AND click without waiting for the WS to attach first.
      // This is the user-perceptible regression scenario the fix
      // targets — before the fix, the race produced manual-send park.
      await page.goto(`/tasks/${taskId}`);
      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible({ timeout: 10_000 });
      const clickAt = Date.now();
      await launchCta.click();

      // POSITIVE: the auto-execute data-frame must fire.
      const launchPredicate = launchSendForTask(taskId, clickAt);
      const launch = await awaitFrame(
        page,
        cap,
        (f, env) => {
          if (!launchPredicate(f, env)) return false;
          const sock = cap.sockets.get(f.socketId);
          return sock !== undefined && isTerminalSocket(sock.url, taskId);
        },
        { timeoutMs: AUTO_EXECUTE_WINDOW_MS },
      );
      expect(
        launch,
        "auto-execute data-frame must fire after Launch click (prewarm-race fixed)",
      ).not.toBeNull();
      if (!launch) return;

      const payload = (launch.env as { payload: string }).payload;
      expect(payload).toContain("claude --session-id");
      expect(payload.endsWith("\r")).toBe(true);

      // NEGATIVE: the manual-send confirm UI must NOT appear. Before
      // the fix this dialog rendered because the one-shot guard
      // armed on `ptyReused:true`. The button's testid is not
      // explicitly set, so we assert by text content: the banner
      // "auto-run is disabled" + a "Send to terminal" button are
      // both load-bearing manual-send signals.
      const manualSendDialog = page.getByText(
        /auto-run is disabled|Send to terminal/i,
      );
      await expect(
        manualSendDialog,
        "manual-send park dialog must NOT appear when auto-execute fires",
      ).toHaveCount(0, { timeout: 1_000 });
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
