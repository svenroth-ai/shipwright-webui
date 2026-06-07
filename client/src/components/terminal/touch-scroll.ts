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
 * into one of two destinations, switched by the active xterm buffer:
 *
 *   - normal buffer  → `term.scrollLines(lines)` (xterm's viewport API
 *     advances within the scrollback)
 *   - alt buffer     → arrow-key escape sequences sent to the pty via the
 *     `deps.sendData` callback (Cursor-Up `\x1b[A` × |lines| for upward
 *     pans, Cursor-Down `\x1b[B` × lines for downward pans). The TUI
 *     consuming the pty (Claude Code, vim, less, htop) scrolls itself.
 *
 * The buffer-aware split is iterate-2026-06-07-fix-touch-scroll-pty-
 * keystrokes (ADR-132). It closes the regression empirically reproduced by
 * iterate-2026-06-07-fix-touch-scroll-alt-buffer (ADR-131, PR #110):
 * `term.scrollLines()` is a no-op in the alt-screen buffer (DECSET 1049)
 * because the alt-buffer has no scrollback, and Claude Code's TUI runs in
 * alt-screen by default (CLAUDE.md rule 22 / ADR-095, `CLAUDE_CODE_NO_
 * FLICKER=1` default-ON).
 *
 * Two-finger gestures (pinch zoom, etc.) are deliberately left alone so
 * the browser keeps its natives.
 *
 * The pixel→line accumulator (`consumeTouchDelta`) is pure and unit-tested
 * in isolation; `attachTouchScroll` is integration-tested with both the
 * mock-Terminal cohort (`touch-scroll.test.ts`) and a real-`@xterm/xterm`
 * jsdom bench (`touch-scroll.alt-buffer.test.ts`).
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
  /**
   * Pty-data callback for the alt-buffer routing path (ADR-132). When the
   * active xterm buffer is `alternate`, the touchmove handler emits arrow-
   * key escape sequences here instead of calling `term.scrollLines()`
   * (which is a no-op in alt-buffer). The EmbeddedTerminal mount-effect
   * wires this to `socket.send({type:"data", payload})` — the same path
   * used by `term.onData` for user keystrokes — so the TUI consuming the
   * pty (Claude Code / vim / less / htop) scrolls itself.
   *
   * Optional for unit-test ergonomics; when absent in alt-buffer the
   * handler short-circuits (no throw, no scrollLines fallback). The
   * production wiring always provides it.
   */
  sendData?: (data: string) => void;
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
      routeScroll(term, lines, deps.sendData);
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

/**
 * Buffer-aware routing of an integer line-count to either xterm's
 * viewport (normal-buffer scrollback) or pty-data arrow-key escapes
 * (alt-buffer; the TUI scrolls itself). ADR-132.
 *
 * Sign convention matches `consumeTouchDelta`: positive `lines` → scroll
 * DOWN (Cursor-Down `\x1b[B`), negative → scroll UP (Cursor-Up `\x1b[A`).
 *
 * Alt-buffer with no `sendData` callback is a clean no-op — `term.scroll
 * Lines()` would be a no-op anyway, but routing through it would mask
 * test-bench errors where the caller forgot to wire `sendData`.
 */
function routeScroll(
  term: Terminal,
  lines: number,
  sendData: ((data: string) => void) | undefined,
): void {
  const inAltBuffer = term.buffer.active.type === "alternate";
  if (inAltBuffer) {
    if (!sendData) return;
    const seq = lines > 0 ? "\x1b[B" : "\x1b[A";
    sendData(seq.repeat(Math.abs(lines)));
    return;
  }
  term.scrollLines(lines);
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
