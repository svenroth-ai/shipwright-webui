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
        }, delay),
      );
    }
  };

  return { schedule, clear };
}
