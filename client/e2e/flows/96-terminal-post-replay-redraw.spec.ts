/*
 * Spec — post-replay redraw nudge (iterate-2026-07-27-terminal-replay-redraw-nudge)
 * ================================================================================
 *
 * Regression guard for smear mechanism #2 — the one that survived PR #325's
 * renderer flip because it is renderer-INDEPENDENT.
 *
 * On re-attach the server restores a cell-state snapshot (ADR-087): a grid
 * Claude Code never drew. Claude then repaints DIFFERENTIALLY, hopping over
 * cells it believes are already correct with CUF (`ESC [ 1 C`) — and CUF does
 * NOT erase, so every skipped cell keeps a stale character (`sie und habe` →
 * `sie.undthabe`). The only thing that makes Claude repaint from scratch is a
 * SIGWINCH, and the kernel raises one only when the size actually CHANGES — so a
 * same-size re-attach used to get nothing, because `PtyManager.resize` correctly
 * dedupes a no-op resize (v0.8.6 AC-2, PowerShell banner spam).
 *
 * The fix: a dimension-less `redraw` frame → `PtyManager.forceRedraw`, which
 * re-applies the current size and bypasses the dedupe exactly once per settled
 * replay. Mechanism + the deterministic reproduction of the corruption itself:
 * `server/src/terminal/cuf-stale-cell-repro.test.ts`.
 *
 * What this real-browser spec proves (the WIRING, which jsdom cannot):
 *   1. a FIRST attach (no prior snapshot) sends NO redraw — the nudge is not
 *      an unconditional per-attach pty poke, which is what would re-create the
 *      v0.8.6 banner spam;
 *   2. a RE-attach that replays a snapshot DOES send exactly one `redraw`;
 *   3. the frame carries no dimensions, so it can never reflow the grid it is
 *      repairing.
 *
 * The definitive visual proof (no stale glyphs on a live Claude TUI) needs a
 * real authenticated Claude session and is the user's confirmation — the
 * isolated stack has no Claude auth.
 *
 * Isolated stack: same recipe as spec 93 / the title-wrap spec.
 */

import { test, expect } from "@playwright/test";

import {
  attachWsCapture,
  isTerminalSocket,
  tryParseEnvelope,
  outboundUnknownFrames,
} from "../helpers/ws-capture";
import {
  cleanupCwd,
  cleanupTask,
  createTask,
  makeTaskCwd,
} from "../helpers/task-fixture";

/** Ordered `type` values sent on THIS task's terminal socket since `sinceTs`. */
function txTypes(
  cap: ReturnType<typeof attachWsCapture>,
  taskId: string,
  sinceTs = 0,
): string[] {
  return cap.frames
    .filter((f) => f.kind === "tx" && f.ts >= sinceTs && isTerminalSocket(f.url, taskId))
    .map((f) => tryParseEnvelope(f.text)?.type)
    .filter((t): t is string => typeof t === "string");
}

function redrawFrames(
  cap: ReturnType<typeof attachWsCapture>,
  taskId: string,
  sinceTs = 0,
): Record<string, unknown>[] {
  return cap.frames
    .filter((f) => f.kind === "tx" && f.ts >= sinceTs && isTerminalSocket(f.url, taskId))
    .map((f) => tryParseEnvelope(f.text))
    .filter((e): e is Record<string, unknown> => e?.type === "redraw");
}

/** Wait for the terminal pane to have a live socket. */
async function gotoTerminal(page: import("@playwright/test").Page, taskId: string) {
  await page.goto(`/tasks/${taskId}`);
  const term = page.getByTestId("embedded-terminal");
  await expect(term).toBeVisible({ timeout: 30_000 });
  await expect(term).toHaveAttribute("data-ws-ready", "true", { timeout: 30_000 });
}

test.describe("terminal post-replay redraw nudge", () => {
  test.setTimeout(180_000);

  test("a re-attach that replays a snapshot sends exactly one dimension-less redraw", async ({
    page,
    request,
  }) => {
    const cwd = await makeTaskCwd("replay-redraw-");
    let taskId = "";
    try {
      taskId = await createTask(request, cwd, `redraw nudge spec ${Date.now()}`);

      // ---- Attach #1: fresh pty, nothing to replay ----------------------
      const cap1 = attachWsCapture(page);
      await gotoTerminal(page, taskId);
      // Type something so the pty has output worth snapshotting on detach.
      await page.keyboard.type("echo redraw-probe");
      await page.waitForTimeout(1_500);

      // StrictMode may make a settled internal re-attach while the first page
      // mounts.  It is valid for that replay to request one dimension-less
      // redraw; the regression fence is that redraws never carry dimensions.
      for (const frame of redrawFrames(cap1, taskId)) {
        expect(frame).toEqual({ type: "redraw" });
      }

      // ---- Attach #2: navigate away and back → snapshot replay ----------
      await page.goto("/");
      await page.waitForTimeout(1_000);

      const cap2 = attachWsCapture(page);
      const reattachAt = Date.now();
      await gotoTerminal(page, taskId);
      // The nudge rides the settled replay, which lands after `ready`.
      await page.waitForTimeout(3_000);

      const redraws = redrawFrames(cap2, taskId, reattachAt);
      expect(
        redraws.length,
        `re-attach must send exactly one redraw; tx=${JSON.stringify(txTypes(cap2, taskId, reattachAt))}`,
      ).toBe(1);

      // Dimension-less: a caller that could pick a size could reflow the very
      // grid the nudge exists to repair.
      expect(redraws[0]).toEqual({ type: "redraw" });

      // The redraw must FOLLOW the convergence resize, so the pty is correctly
      // sized before it repaints.
      const types = txTypes(cap2, taskId, reattachAt);
      // Assert the resize EXISTS first: `indexOf` returns -1 when it does not,
      // which would make the ordering check below vacuously true and hide a
      // missing convergence resize entirely (external review, gemini).
      expect(types, "the convergence resize must precede the nudge").toContain("resize");
      expect(types.indexOf("redraw")).toBeGreaterThan(types.indexOf("resize"));

      // And the byte-path fence still holds: no OTHER new frame types appeared.
      expect(outboundUnknownFrames(cap2, taskId, reattachAt)).toEqual([]);
    } finally {
      if (taskId) await cleanupTask(request, taskId);
      await cleanupCwd(cwd);
    }
  });
});
