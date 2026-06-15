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
 * into the SAME wheel events the mouse / trackpad already emits — so the
 * finger behaves exactly like the mouse wheel that already works. The
 * routing (ADR-133, iterate-2026-06-15-touch-scroll-wheel-events) is:
 *
 *   - mouse-tracking active (`.enable-mouse-events` on `term.element`) OR
 *     alt-screen buffer  → dispatch a synthetic `WheelEvent` onto
 *     `term.element`. xterm's own wheel handlers (CoreBrowserTerminal
 *     `bindMouse`) then do exactly what they do for a real mouse wheel:
 *       · mouse-tracking on  → encode a mouse-report (button 64/65) in the
 *         protocol/encoding the app negotiated, byte-identical to the
 *         working mouse wheel. Claude Code's TUI consumes this to scroll.
 *       · mouse-tracking off (vim / less / htop in alt-screen) → xterm
 *         converts the wheel into Cursor-Up/Down keystrokes itself
 *         (honouring application-cursor-keys mode: `\x1bOA` vs `\x1b[A`).
 *   - normal buffer, no mouse tracking  → `term.scrollLines(lines)`
 *     (xterm's viewport API advances within the scrollback). The scrollback
 *     scroller lives on a *descendant* of `term.element`, so a wheel
 *     dispatched at the root would not reach it — `scrollLines` is the
 *     correct, proven primitive here and is left untouched.
 *
 * Why this supersedes ADR-131/132: those routed alt-buffer pans to raw
 * arrow-key escapes on the theory that alt-screen TUIs scroll on arrows
 * (true for vim/less). But Claude Code runs in alt-screen WITH mouse
 * tracking enabled and binds Up/Down to input-history navigation, so the
 * arrows cycled through the last prompts instead of scrolling (user report
 * 2026-06-15). Replicating the mouse wheel — the thing that already works —
 * fixes it by construction and deletes the brittle arrow/SGR guessing.
 *
 * Two-finger gestures (pinch zoom, etc.) are deliberately left alone so
 * the browser keeps its natives.
 *
 * The pixel→line accumulator (`consumeTouchDelta`) is pure and unit-tested
 * in isolation; `attachTouchScroll`'s routing is integration-tested with
 * the mock-Terminal cohort (`touch-scroll.test.ts`). The xterm buffer-state
 * facts that justify routing away from `scrollLines` in the alt-buffer are
 * pinned by the real-`@xterm/xterm` bench (`touch-scroll.alt-buffer.test.ts`).
 */

import type { Terminal } from "@xterm/xterm";

/** `WheelEvent.deltaMode` for pixel-granularity deltas (spec value 0x00). */
const DOM_DELTA_PIXEL = 0;

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

  // Reserve the one-finger vertical gesture for our handler. With the default
  // `touch-action: auto` the browser arbitrates the drag as a native pan and
  // never delivers `touchmove`, so touch-scroll did nothing on real devices
  // (iterate-2026-06-14-tablet-view-polish AC-5). The synthetic-touch tests
  // below dispatch events straight at the element, bypassing arbitration —
  // which is exactly why this regression went unnoticed. Restored on dispose.
  const prevTouchAction = container.style.getPropertyValue("touch-action");
  container.style.setProperty("touch-action", "none");

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
    routeScroll(term, state, deltaPx, pxPerLine, tracked.clientX, tracked.clientY);
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
    if (prevTouchAction) {
      container.style.setProperty("touch-action", prevTouchAction);
    } else {
      container.style.removeProperty("touch-action");
    }
  };
}

/**
 * Route one touchmove's pixel delta to the scroll mechanism that matches
 * the mouse / trackpad for the terminal's current state (ADR-133):
 *
 *   - mouse-tracking active OR alt-screen buffer → forward the raw pixel
 *     delta as a `WheelEvent` on `term.element`. xterm's own handlers then
 *     do exactly what they do for a two-finger trackpad scroll: encode a
 *     mouse-report (Claude's alt-screen, mouse-tracking on) or convert to
 *     arrow keys (no-mouse alt-screen TUI), with its own trackpad-style
 *     sub-line accumulation (`CoreMouseService.consumeWheelEvent`).
 *   - otherwise (normal buffer, no mouse tracking) → accumulate whole lines
 *     and `term.scrollLines` the scrollback (the scroller lives on a
 *     descendant of `term.element`, unreachable by a root-dispatched wheel).
 *
 * Defensive: if `term.element` is not yet populated we fall back to the
 * scrollback path (a no-op in the alt-buffer, but never a throw).
 *
 * Sign convention: `deltaPx > 0` (finger moved UP) ⇒ scroll DOWN ⇒ wheel
 * `deltaY > 0` and positive `scrollLines`.
 */
function routeScroll(
  term: Terminal,
  state: TouchScrollState,
  deltaPx: number,
  pxPerLine: number,
  clientX: number,
  clientY: number,
): void {
  const el = term.element ?? null;
  const mouseActive = !!el?.classList?.contains("enable-mouse-events");
  const inAltBuffer = term.buffer.active.type === "alternate";

  if (el && (mouseActive || inAltBuffer)) {
    if (deltaPx !== 0) dispatchWheel(el, deltaPx, clientX, clientY);
    return;
  }
  const lines = consumeTouchDelta(state, deltaPx, pxPerLine);
  if (lines !== 0) term.scrollLines(lines);
}

/**
 * Dispatch a single pixel-granularity `WheelEvent` onto xterm's root
 * element, carrying the finger's pixel delta — the touch analogue of a
 * two-finger trackpad scroll. xterm turns it into the mouse-report /
 * arrow-key sequence appropriate to the active mode, with its own
 * sub-pixel accumulation, so the bytes reaching the pty (and the feel) are
 * identical to the trackpad scroll that already works.
 *
 * `clientX/clientY` carry the finger position so xterm reports the cell
 * under the finger (`getMouseReportCoords`), matching pointer semantics.
 */
function dispatchWheel(
  el: HTMLElement,
  deltaPx: number,
  clientX: number,
  clientY: number,
): void {
  el.dispatchEvent(
    new WheelEvent("wheel", {
      // deltaY > 0 ⇒ scroll DOWN (xterm: CoreMouseAction.DOWN / Cursor-Down).
      deltaY: deltaPx,
      deltaMode: DOM_DELTA_PIXEL,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
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
