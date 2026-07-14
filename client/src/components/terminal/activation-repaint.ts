/*
 * activation-repaint — DATA-INDEPENDENT trailing repaints after a layout change
 * that re-shows the embedded terminal: a Transcript→Terminal tab switch, a
 * window visibility/focus restore, or a bfcache page-show.
 *
 * Distinct from `repaint-on-settle.ts` (DATA-DRIVEN — repaints on each parsed
 * write) and MUST coexist with it (iterate-2026-06-22, Chesterton's fence):
 * an IDLE Claude session parked at a prompt emits NO writes after the switch,
 * so the settle window contributes nothing. The single synchronous
 * `term.refresh` in useTerminalResize fires the instant the tab flips — before
 * the just-un-hidden (display:none → block) WebGL canvas is composited at its
 * real size — so the stale frame persists ("smear" on a tab switch with an
 * idle session, user report 2026-06-22). These deferred passes land AFTER the
 * composite settles and repaint regardless of data flow.
 *
 * Restores the pre-#164 130/350 ms heal for the no-data path; PR #164 dropped
 * the fixed trailing timers when it consolidated the data-driven case into
 * repaint-on-settle.ts, which left the idle tab-switch uncovered.
 *
 * ZERO React imports — pure imperative schedule/clear, unit-tested in isolation
 * (activation-repaint.test.ts), mirroring repaint-on-settle.ts / scroll-repaint.ts.
 */

import type { Terminal } from "@xterm/xterm";

/**
 * Trailing repaint delays (ms) from `schedule()`. Two staggered passes cover a
 * slow multi-frame Windows/ANGLE composite after the canvas un-hides; both are
 * GPU-cheap full-viewport `term.refresh` calls that only fire on a layout-change
 * event, never on a stream.
 */
export const ACTIVATION_REPAINT_DELAYS_MS = [130, 350] as const;

export interface ActivationRepaintDeps {
  /** Test seam for `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Test seam for `clearTimeout`. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /**
   * The WebGL glyph-atlas heal (`term.clearTextureAtlas()` behind the #206
   * deferred/coalesced fence — `webgl-atlas-repaint.ts`). Read lazily: the
   * caller holds it behind a ref that is null before mount, after dispose, and
   * for the whole life of the DOM-renderer arm (no atlas → nothing to clear).
   * See ATLAS HEAL below for why it rides the LAST pass.
   */
  getHealAtlas?: () => (() => void) | null | undefined;
}

export interface ActivationRepaintHandle {
  /**
   * Cancel any in-flight passes and schedule a fresh set from now. Idempotent —
   * a rapid re-activation collapses to a single pending set rather than stacking.
   */
  schedule(): void;
  /** Cancel all pending passes (call on unmount / dispose). */
  clear(): void;
}

/**
 * `getTerm` is read lazily (the caller holds the term behind a ref that may be
 * null before mount or after dispose); `isDisposed` is re-checked at each async
 * tail so a refresh never lands on a mid-dispose terminal (ADR-084 parity).
 */
export function createActivationRepaint(
  getTerm: () => Terminal | null,
  isDisposed: () => boolean,
  deps: ActivationRepaintDeps = {},
): ActivationRepaintHandle {
  const setT = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = deps.clearTimer ?? ((h) => clearTimeout(h));
  let timers: ReturnType<typeof setTimeout>[] = [];

  const clear = (): void => {
    for (const t of timers) clearT(t);
    timers = [];
  };

  /**
   * ATLAS HEAL — `term.refresh` CANNOT undo glyph-atlas corruption (it routes to
   * WebglRenderer._updateModel, which skips cells that "look unchanged"), so the
   * trailing passes above are powerless against the "wrong letter" class. The
   * heal clears the texture AND the render model (`clearTextureAtlas`).
   *
   * It rides EVERY pass, not just the last — and that is a corrected decision.
   * The first draft healed only on the trailing pass, on the theory that an
   * early clear (against a `display:none → block` canvas that has not composited
   * at its real size) would be "wasted AND leave a model no later refresh can
   * fix". The doubt-review disproved the second half against the installed
   * @xterm/addon-webgl: `clearTextureAtlas → _clearModel(true) →
   * GlyphRenderer.clear()` invalidates every atlas texture (`version = -1`), and
   * the next frame re-uploads each page whose version differs. Model and atlas
   * are therefore CONSISTENT after any clear — an early heal is redundant, never
   * poisoning. Healing on every pass is thus free, and it buys the thing that
   * matters: a second shot if the compositor is late. A single fixed deadline is
   * exactly the fragility #167 already learned to avoid (it shipped TWO refresh
   * passes for the same reason).
   *
   * Never synchronous on the event, though: that would be a third clear with
   * nothing to gain (the first pass is 130 ms away).
   *
   * A no-op in the DOM-renderer arm (no atlas). Throws are swallowed for the
   * same reason as the refresh above — a mid-dispose term is expected, and the
   * next schedule() re-arms.
   */
  const healAtlas = (): void => {
    try {
      deps.getHealAtlas?.()?.();
    } catch {
      /* term/addon mid-dispose — the #206 fence re-checks `disposed` too */
    }
  };

  const schedule = (): void => {
    clear();
    if (isDisposed()) return;
    for (const delay of ACTIVATION_REPAINT_DELAYS_MS) {
      timers.push(
        setT(() => {
          if (isDisposed()) return;
          const term = getTerm();
          if (!term) return;
          try {
            term.refresh(0, term.rows - 1);
          } catch {
            /* term mid-dispose — a later schedule() reschedules a fresh pass */
          }
          healAtlas();
        }, delay),
      );
    }
  };

  return { schedule, clear };
}
