/*
 * Spec — pre-launch pty size-sync (iterate-2026-07-01-terminal-title-wrap-smear)
 * ==============================================================================
 *
 * Regression guard for the "D er" title-wrap smear. The pty is spawned at a
 * hardcoded 120 cols (server default); the client's REAL (often narrower,
 * half-screen) width reaches the pty only via a throttled `resize`. When the
 * auto-launched `claude … --name "<long title>"` runs before the real width is
 * applied, Claude renders its width-sensitive black-on-cyan title-pill banner
 * at 120; on a narrower xterm grid the wrapping banner auto-wraps one extra row
 * and the title's first char collides onto the `>` prompt row ("Der" → "D er").
 *
 * The fix (useAutoLaunch `onBeforeDispatch` → EmbeddedTerminal `syncSizeNow`)
 * fits + emits a `resize` on the SAME ordered WS IMMEDIATELY before the launch
 * data-frame, so the pty is at the real width when Claude starts.
 *
 * What this real-browser spec proves (the wiring): the terminal WS receives a
 * `resize` frame that (a) is the tx frame immediately preceding the launch
 * data-frame AND (b) fires within a tight window before it — distinguishing the
 * fix's just-before-dispatch sync from the baseline mount-time resize (which
 * lands well before the ≥250 ms-post-ready launch). The DEFINITIVE visual proof
 * (no glyph collision) needs a real Claude session + long title + narrow pane
 * and is validated by the user; the isolated stack has no Claude auth.
 *
 * Isolated stack: same recipe as C5 (production build, USERPROFILE=tmp,
 * SHIPWRIGHT_NETWORK_PROFILE=local, alt PORT; BASE_URL → skip managed webServer).
 */

import { test, expect } from "@playwright/test";

import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  tryParseEnvelope,
  type CapturedFrame,
  type WsCapture,
} from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

/**
 * Upper bound on delta(last resize → launch data-frame). The fix emits the
 * resize synchronously right before the command; the baseline mount-time
 * resize lands ≥250 ms earlier (the launch waits for the prompt-readiness
 * quiesce after `ready`). 150 ms keeps a ~2× margin against Windows jitter
 * while still failing if the pre-dispatch sync is removed.
 */
const SYNC_ADJACENCY_MAX_MS = 150;

function launchDataFrame(cap: WsCapture, taskId: string) {
  return (f: CapturedFrame, env: Record<string, unknown> | null): boolean => {
    if (f.kind !== "tx") return false;
    if (env?.type !== "data") return false;
    if (!isTerminalSocket(f.url, taskId)) return false;
    const payload = (env as { payload?: unknown }).payload;
    return typeof payload === "string" && payload.includes("claude --session-id");
  };
}

test.describe("terminal pre-launch pty size-sync (title-wrap smear guard)", () => {
  test.setTimeout(120_000);

  test("emits a resize on the terminal WS immediately before the launch command", async ({
    page,
    request,
  }) => {
    // A long title mirrors the real repro (only wrapping titles smear); it does
    // not change the wiring assertion below.
    const cwd = await makeTaskCwd("titlewrap-sizesync-");
    let taskId = "";
    try {
      taskId = await createTask(
        request,
        cwd,
        `Fix for github_triage artifact-ingest counts inline-suppressed ` +
          `Semgrep findings as live, inflating gh-security triage ${Date.now()}`,
      );

      const cap = attachWsCapture(page);
      await page.goto(`/tasks/${taskId}`);

      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible({ timeout: 10_000 });
      await launchCta.click();

      const launch = await awaitFrame(page, cap, launchDataFrame(cap, taskId), {
        timeoutMs: 30_000,
      });
      expect(launch, "auto-execute `claude --session-id` data-frame").not.toBeNull();
      if (!launch) return;

      // Ordered tx frames on THIS task's terminal socket.
      const termTx = cap.frames.filter(
        (f) => f.kind === "tx" && isTerminalSocket(f.url, taskId),
      );
      const launchIdx = termTx.findIndex((f) => f.ts === launch.frame.ts && f.text === launch.frame.text);
      expect(launchIdx, "launch frame located among terminal tx frames").toBeGreaterThan(0);

      // The tx frame immediately preceding the launch command must be a resize
      // (the syncSizeNow pre-dispatch sync), carrying numeric cols/rows.
      const prevEnv = tryParseEnvelope(termTx[launchIdx - 1].text);
      expect(prevEnv?.type, "tx frame immediately before launch is a `resize`").toBe(
        "resize",
      );
      expect(typeof prevEnv?.cols, "resize.cols is numeric").toBe("number");
      expect(typeof prevEnv?.rows, "resize.rows is numeric").toBe("number");

      // …and it fires just before dispatch (not the far-earlier mount resize).
      const delta = launch.frame.ts - termTx[launchIdx - 1].ts;
      expect(
        delta,
        `resize→launch delta=${delta}ms must be < ${SYNC_ADJACENCY_MAX_MS}ms ` +
          `(pre-dispatch size sync is wired)`,
      ).toBeLessThan(SYNC_ADJACENCY_MAX_MS);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
