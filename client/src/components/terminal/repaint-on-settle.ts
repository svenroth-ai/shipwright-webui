/*
 * repaint-on-settle — DATA-DRIVEN full-viewport repaint after a layout change.
 *
 * iterate-2026-06-20 AC-4. Supersedes the fixed 130/350 ms trailing repaints
 * (the old `POST_RESIZE_REPAINT_DELAYS_MS` in useTerminalResize) that healed
 * the WebGL partial-dirty smear after a resize / tab-activation /
 * window-refocus.
 *
 * Bug: on a slow mobile path Claude's async alt-buffer redraw lands AFTER the
 * fixed timer window closes, so the final stale frame is never repainted —
 * smear on a Transcript→Terminal switch and on return-from-home-screen
 * (user report 2026-06-20, two screenshots). The fixed delay is an open-loop
 * guess at the redraw latency; on a phone the guess is wrong.
 *
 * Root-cause fix: react to the ACTUAL redraw instead of guessing its latency.
 * After a layout-change trigger the window is ARMED; while armed, every parsed
 * write (`term.onWriteParsed`) schedules a coalesced full `term.refresh(0,
 * rows-1)`. The window closes SETTLE_QUIET_MS after the last write OR at a hard
 * SETTLE_MAX_MS cap from arm() — whichever comes first — so it never repaints
 * forever on a chatty stream and never disarms before the first (possibly
 * late) redraw arrives.
 *
 * Triggers:
 *   - `term.onResize` (window resize, or a tab/pane growing 0→full) → armed
 *     INTERNALLY, since a resize is itself a layout change.
 *   - tab-activation + window visibility/focus restore → the caller calls
 *     `arm()` (those don't necessarily change cols/rows, so onResize may not
 *     fire — see useTerminalResize).
 *
 * ZERO React imports — pure imperative attach/dispose, unit-tested in
 * isolation (repaint-on-settle.test.ts), mirroring scroll-repaint.ts /
 * touch-scroll.ts.
 */

import type { Terminal } from "@xterm/xterm";

/** Quiet gap (ms) AFTER the last parsed write that closes the settle window. */
export const SETTLE_QUIET_MS = 450;
/**
 * Hard cap (ms) from `arm()` — the window never stays open longer than this,
 * even on a continuous stream. Generous enough to cover a slow mobile WS
 * round-trip + Claude's alt-buffer redraw; the repaint is GPU-cheap (one
 * coalesced viewport refresh per frame) and only fires while data is flowing.
 */
export const SETTLE_MAX_MS = 3000;

export interface SettleRepaintDeps {
  /** Test seam for `requestAnimationFrame`. */
  requestFrame?: (cb: () => void) => number;
  /** Test seam for `cancelAnimationFrame`. */
  cancelFrame?: (handle: number) => void;
  /** Test seam for `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Test seam for `clearTimeout`. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface SettleRepaintHandle {
  /**
   * Open the settle window after a layout change the caller knows about
   * (tab-activation, window visibility/focus restore). Resize-driven changes
   * are armed internally via `term.onResize`. Idempotent — re-arming resets
   * the hard cap and waits for the new window's first write.
   */
  arm(): void;
  /** Remove the onWriteParsed/onResize listeners + cancel any pending work. */
  dispose(): void;
}

/**
 * Attach the data-driven settle-repaint to an open xterm. `isDisposed` is read
 * at every async tail so a refresh never lands on a mid-dispose terminal
 * (ADR-084 ordering parity with the shell mount-effect).
 */
export function attachSettleRepaint(
  term: Terminal,
  isDisposed: () => boolean,
  deps: SettleRepaintDeps = {},
): SettleRepaintHandle {
  const raf = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const setT = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = deps.clearTimer ?? ((h) => clearTimeout(h));

  let armed = false;
  let frame: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  const repaintFull = (): void => {
    if (isDisposed()) return;
    try {
      term.refresh(0, term.rows - 1);
    } catch {
      /* term mid-dispose — the next write/arm reschedules a fresh repaint */
    }
  };

  const scheduleRepaint = (): void => {
    // Coalesce a burst of writes in one frame into a single viewport refresh.
    if (frame !== null) return;
    frame = raf(() => {
      frame = null;
      repaintFull();
    });
  };

  const clearQuiet = (): void => {
    if (quietTimer !== null) {
      clearT(quietTimer);
      quietTimer = null;
    }
  };

  const disarm = (): void => {
    armed = false;
    clearQuiet();
    if (maxTimer !== null) {
      clearT(maxTimer);
      maxTimer = null;
    }
    // Cancel a queued frame so disarm is a true full stop: without this, a
    // frame scheduled just before the hard cap fires one extra (benign)
    // refresh after the window closed. `repaintFull` only guards isDisposed(),
    // not `armed`, so we cancel here for symmetry with dispose().
    if (frame !== null) {
      caf(frame);
      frame = null;
    }
  };

  const arm = (): void => {
    if (isDisposed()) return;
    armed = true;
    // Clear any quiet timer from a prior window so the NEW window waits for
    // its own first write (the late mobile redraw can arrive well after the
    // previous window's quiet gap).
    clearQuiet();
    if (maxTimer !== null) clearT(maxTimer);
    maxTimer = setT(disarm, SETTLE_MAX_MS);
  };

  const onWrite = (): void => {
    if (!armed || isDisposed()) return;
    scheduleRepaint();
    // (Re)start the quiet timer — the window closes SETTLE_QUIET_MS after the
    // last write (or at the hard cap, whichever is first).
    clearQuiet();
    quietTimer = setT(disarm, SETTLE_QUIET_MS);
  };

  const writeDisposable = term.onWriteParsed(onWrite);
  // A resize is itself a layout change (window resize, or a pane growing from
  // 0→full when its tab activates): arm so the async redraw at the new size
  // repaints clean.
  const resizeDisposable = term.onResize(arm);

  return {
    arm,
    dispose() {
      disarm(); // cancels the queued frame + both timers
      try {
        writeDisposable.dispose();
      } catch {
        /* best-effort — term may already be disposed */
      }
      try {
        resizeDisposable.dispose();
      } catch {
        /* best-effort */
      }
    },
  };
}
