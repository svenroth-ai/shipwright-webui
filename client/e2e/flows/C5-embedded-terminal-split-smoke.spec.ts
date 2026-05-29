/*
 * Spec C5 — EmbeddedTerminal post-split auto-execute smoke
 * ========================================================
 *
 * Backfills the deferred MANDATORY E2E fence from campaign
 * 2026-05-25-bloat-cleanup-C-webui sub-iterate C5 (PR #70, merged
 * `d626596`). C5 split EmbeddedTerminal.tsx (1856 → 287 LOC) into
 * a thin shell + 7 sub-modules; the LOAD-BEARING ADR-068-A1
 * auto-execute path (Launch click → ready{role:"writer"} →
 * 250 ms prompt-readiness quiesce → client-side
 * `{type:"data", payload:"claude --session-id …"}` WS frame) had
 * NEVER been driven by a real browser post-split. This spec closes
 * that gap.
 *
 * Test 1 — Launch path (fresh pty). Click Launch CTA immediately
 *   after page-load (mirroring real user with the post-ADR-068-A1
 *   prewarm-race fix in place — see iterate-2026-05-27-fix-pty-reused-
 *   prewarm-race / PR #75). Assert first ready envelope shows
 *   role:"writer" + ptyReused:false (atomic hadPriorWriter snapshot)
 *   AND a `claude --session-id` data-frame is SENT ≥ 200 ms
 *   (and < 2000 ms) after click — lower bound proves the 250 ms
 *   quiesce gate (useAutoLaunch.ts:34) is wired; upper bound
 *   catches multi-second hangs (external-review gemini #2 medium).
 *
 * Test 2 — Resume re-attach (pty reused). After Launch, page.reload().
 *   The SECOND `ready` envelope must have `ptyReused: true` — proves
 *   the pty survived the React-tree teardown and `pty-manager.get()`
 *   correctly reports an existing entry. The downstream "Resume click
 *   does not auto-fire a duplicate launch" guard (useAutoLaunch.ts
 *   97-130) is covered by unit tests in EmbeddedTerminal.test.tsx
 *   (204 cases); driving it E2E would require Claude to actually
 *   bootstrap, which the isolated USERPROFILE prevents (no auth,
 *   no plugin config under `$tmp/.claude/`).
 *
 * Isolated stack (memory feedback_iterate_e2e_isolated_userprofile +
 * feedback_dev_vs_autostart_port_conflict): boot the production
 * build with USERPROFILE + HOME = tmp dir, SHIPWRIGHT_NETWORK_PROFILE=local,
 * PORT=4847; run Playwright with BASE_URL=http://127.0.0.1:4847.
 * Production build defeats the dev-only StrictMode WS race (memory
 * strictmode_aborts_first_ws_in_e2e). See iterate spec for the
 * exact invocation snippet.
 */

import { test, expect } from "@playwright/test";

import {
  attachWsCapture,
  awaitFrame,
  isTerminalSocket,
  type CapturedFrame,
  type WsCapture,
} from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

// ----- thresholds --------------------------------------------------

/** Lower bound on the quiesce delay (handshake constant 250 ms;
 *  loosened by 50 ms for Windows clock jitter). */
const QUIESCE_MIN_MS = 200;
/** Upper bound — catches a "hangs for seconds" regression. */
const QUIESCE_MAX_MS = 2000;

// Predicates filter on FRAME timestamp (not socket-open) so the
// post-reload second ready is unambiguous.

function readyForTask(cap: WsCapture, taskId: string, afterMs: number) {
  return (f: CapturedFrame, env: Record<string, unknown> | null): boolean => {
    if (f.kind !== "rx") return false;
    if (env?.type !== "ready") return false;
    if (f.ts < afterMs) return false;
    const sock = cap.sockets.get(f.socketId);
    if (!sock) return false;
    return isTerminalSocket(sock.url, taskId);
  };
}

function launchSendForTask(cap: WsCapture, taskId: string, afterMs: number) {
  return (f: CapturedFrame, env: Record<string, unknown> | null): boolean => {
    if (f.kind !== "tx") return false;
    if (env?.type !== "data") return false;
    if (f.ts < afterMs) return false;
    const sock = cap.sockets.get(f.socketId);
    if (!sock) return false;
    if (!isTerminalSocket(sock.url, taskId)) return false;
    const payload = (env as { payload?: unknown }).payload;
    return typeof payload === "string" && payload.includes("claude --session-id");
  };
}

// ----- the tests --------------------------------------------------

test.describe("Spec C5 — EmbeddedTerminal post-split auto-execute smoke", () => {
  test.setTimeout(120_000);

  test("Launch CTA emits ready{role:'writer',ptyReused:false} then quiesced auto-execute data-frame", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("c5-smoke-launch-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `c5-smoke-launch-${Date.now()}`);

      const cap = attachWsCapture(page);
      const navAt = Date.now();
      await page.goto(`/tasks/${taskId}`);

      // Click Launch immediately after CTA is visible — mirrors a real
      // user. The prior wait-for-first-ready workaround was removed in
      // iterate-2026-05-27-remove-c5-wait-for-ready-workaround after
      // PR #75 fixed the prewarm race (atomic hadPriorWriter snapshot
      // in pty-manager.attach()): the FIRST WS attach is now the
      // pty-creating one regardless of prewarm-vs-WS ordering.
      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible({ timeout: 10_000 });
      const clickAt = Date.now();
      await launchCta.click();

      // First ready envelope on the terminal WS (may arrive before or
      // after click — predicate filters by frame.ts >= navAt).
      const firstReady = await awaitFrame(page, cap, readyForTask(cap, taskId, navAt), {
        timeoutMs: 30_000,
      });
      expect(firstReady, "first ready envelope on the terminal WS").not.toBeNull();
      if (!firstReady) return;

      const readyEnv = firstReady.env!;
      expect(readyEnv.type).toBe("ready");
      expect(readyEnv.role, "ready.role on first attach must be 'writer'").toBe("writer");
      expect(
        readyEnv.ptyReused,
        "ready.ptyReused on the pty-creating attach must be false " +
          "(post PR #75: hadPriorWriter is atomic-snapshotted in attach())",
      ).toBe(false);
      expect(readyEnv.replayOnly, "ready.replayOnly on a live task must be false").toBe(
        false,
      );
      expect(
        typeof readyEnv.shellKind,
        "ready.shellKind must be a string for a live writer attach",
      ).toBe("string");

      const launch = await awaitFrame(
        page,
        cap,
        launchSendForTask(cap, taskId, clickAt),
        { timeoutMs: 30_000 },
      );
      expect(launch, "auto-execute data-frame with `claude --session-id`").not.toBeNull();
      if (!launch) return;

      const payload = (launch.env as { payload: string }).payload;
      expect(payload).toContain("claude --session-id");
      expect(
        payload.endsWith("\r"),
        "auto-execute payload must terminate with CR for shell submission",
      ).toBe(true);

      // Quiesce assertion: delta(click → data-frame). Constant is 250 ms
      // measured from last pty emission (useAutoLaunch.ts:34); the
      // prompt has typically emitted before click, so observed delta
      // is ≥ 250 ms minus a 50 ms jitter slack.
      const delta = launch.frame.ts - clickAt;
      expect(
        delta,
        `quiesce delta=${delta}ms must be >= ${QUIESCE_MIN_MS}ms (handshake gate is wired)`,
      ).toBeGreaterThanOrEqual(QUIESCE_MIN_MS);
      expect(
        delta,
        `quiesce delta=${delta}ms must be < ${QUIESCE_MAX_MS}ms (no multi-second hang)`,
      ).toBeLessThan(QUIESCE_MAX_MS);
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });

  test("Reload → pty persists; second ready has ptyReused:true (arms one-shot guard)", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("c5-smoke-resume-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `c5-smoke-resume-${Date.now()}`);

      // Phase 1 — click Launch immediately (mirrors Test 1's post-PR-#75 timing).
      const cap1 = attachWsCapture(page);
      await page.goto(`/tasks/${taskId}`);

      const launchCta = page.getByTestId("cta-launch-in-terminal");
      await expect(launchCta).toBeVisible({ timeout: 10_000 });
      const clickAt1 = Date.now();
      await launchCta.click();

      const initialLaunch = await awaitFrame(
        page,
        cap1,
        launchSendForTask(cap1, taskId, clickAt1),
        { timeoutMs: 30_000 },
      );
      expect(
        initialLaunch,
        "phase-1 prerequisite: initial Launch must reach the WS",
      ).not.toBeNull();

      // Phase 2 — reload. The reload tears down the React tree and
      // re-creates the WS attach against the still-live pty.
      await page.reload();
      const reloadAt = Date.now();

      const cap2 = attachWsCapture(page);
      const secondReady = await awaitFrame(
        page,
        cap2,
        readyForTask(cap2, taskId, reloadAt),
        { timeoutMs: 30_000 },
      );
      expect(
        secondReady,
        "second ready envelope after reload (WS re-attaches to the live pty)",
      ).not.toBeNull();
      if (!secondReady) return;
      expect(
        secondReady.env!.ptyReused,
        "ready.ptyReused on reattach must be true (pty existed before this attach)",
      ).toBe(true);
      // The downstream "Resume click does not auto-fire a duplicate
      // launch" assertion is covered by useAutoLaunch unit tests
      // (EmbeddedTerminal.test.tsx, 204 cases). Driving it E2E here
      // requires Claude to bootstrap a JSONL so task.state ∈ {idle,
      // active} renders the Resume CTA, which the isolated USERPROFILE
      // intentionally prevents.
    } finally {
      await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
