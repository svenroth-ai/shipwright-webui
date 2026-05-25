/*
 * Touch-scroll for the embedded xterm — adds one-finger pan-to-scroll for
 * touchscreens.
 *
 * iterate-2026-05-25-fix-terminal-touch-scroll. xterm.js 6.x replaced its
 * native-overflow viewport with a custom `.xterm-scrollable-element` (a
 * VS-Code-derived virtualized scrollbar). That scrollable element listens
 * to `wheel` events but registers no `touch*` listeners, so mouse-wheel
 * scrolling works while a finger drag on a touchscreen does nothing.
 *
 * This module fills that gap by translating a one-finger touchmove delta
 * into `term.scrollLines()` calls. Two-finger gestures (pinch zoom, etc.)
 * are deliberately left alone so the browser keeps its natives.
 *
 * The pixel→line accumulator (`consumeTouchDelta`) is pure and unit-tested
 * in isolation; `attachTouchScroll` is integration-tested with synthetic
 * TouchEvent dispatches against a jsdom container.
 */

import type { Terminal } from "@xterm/xterm";

export interface TouchScrollState {
  active: boolean;
  identifier: number | null;
  lastY: number;
  pixelAccumulator: number;
}

export function createTouchScrollState(): TouchScrollState {
  return { active: false, identifier: null, lastY: 0, pixelAccumulator: 0 };
}

/**
 * Convert a touchmove pixel delta into whole lines to scroll, accumulating
 * the sub-line remainder in `state.pixelAccumulator` so partial drags add
 * up across consecutive touchmove events.
 *
 * Sign convention: `deltaPx > 0` ⇒ finger moved UP relative to last sample
 * ⇒ user wants to scroll the viewport DOWN ⇒ return positive integer.
 *
 * Defensive: returns 0 when `pixelsPerLine <= 0` (xterm not yet measured).
 */
export function consumeTouchDelta(
  state: TouchScrollState,
  deltaPx: number,
  pixelsPerLine: number,
): number {
  if (pixelsPerLine <= 0) return 0;
  state.pixelAccumulator += deltaPx;
  // `Math.trunc` keeps the sub-line remainder in the accumulator for both
  // positive and negative drags (Math.floor would skew negative deltas).
  const lines = Math.trunc(state.pixelAccumulator / pixelsPerLine);
  if (lines !== 0) {
    state.pixelAccumulator -= lines * pixelsPerLine;
  }
  return lines;
}

export interface TouchScrollDeps {
  /**
   * Test seam: override how rendered row-height is measured. Default reads
   * from `.xterm-rows > div:first-child` bounding-box, falling back to
   * `container.clientHeight / term.rows`.
   */
  getPixelsPerLine?: (term: Terminal, container: HTMLElement) => number;
}

/**
 * Attach native touch-scroll listeners to xterm's rendered element so a
 * single finger drag scrolls the terminal viewport. Returns a disposer
 * that removes every listener.
 */
export function attachTouchScroll(
  term: Terminal,
  container: HTMLElement,
  deps: TouchScrollDeps = {},
): () => void {
  const state = createTouchScrollState();
  const getPxPerLine = deps.getPixelsPerLine ?? defaultPixelsPerLine;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      // Multi-touch — abandon any in-progress pan so we don't fight the
      // browser's native pinch handling.
      state.active = false;
      state.identifier = null;
      return;
    }
    const t = e.touches[0];
    state.active = true;
    state.identifier = t.identifier;
    state.lastY = t.clientY;
    state.pixelAccumulator = 0;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!state.active || state.identifier === null) return;
    let tracked: Touch | null = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === state.identifier) {
        tracked = e.touches[i];
        break;
      }
    }
    if (!tracked) return;
    const deltaPx = state.lastY - tracked.clientY;
    state.lastY = tracked.clientY;
    const pxPerLine = getPxPerLine(term, container);
    const lines = consumeTouchDelta(state, deltaPx, pxPerLine);
    if (lines !== 0) {
      term.scrollLines(lines);
    }
    // Suppress browser-native overscroll / pull-to-refresh while panning.
    // touchmove listeners must be {passive: false} for this to take effect
    // (Chrome's default is passive: true).
    if (e.cancelable) e.preventDefault();
  };

  const onTouchEnd = () => {
    state.active = false;
    state.identifier = null;
    state.pixelAccumulator = 0;
  };

  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd, { passive: true });
  container.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchmove", onTouchMove);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchEnd);
  };
}

function defaultPixelsPerLine(term: Terminal, container: HTMLElement): number {
  const rows = container.querySelector<HTMLElement>(".xterm-rows");
  if (rows && rows.children.length > 0) {
    const first = rows.children[0] as HTMLElement;
    const h = first.getBoundingClientRect().height;
    if (h > 0) return h;
  }
  if (term.rows > 0) {
    const h = container.clientHeight / term.rows;
    if (h > 0) return h;
  }
  // Last-resort default — a reasonable monospace cell height. Used only
  // when xterm has neither rendered yet nor reports a row count.
  return 18;
}
