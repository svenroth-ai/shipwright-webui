/*
 * scroll-repaint.test.ts — unit tests for the scroll-triggered full-viewport
 * WebGL repaint (iterate-2026-06-09-fix-terminal-scroll-smear).
 *
 * Pins the contract that fixes the "tables smear when I scroll" bug: a
 * viewport scroll (normal buffer) OR a raw wheel (alt buffer — Claude's TUI
 * redraws via async writes the wheel triggers) schedules a FULL
 * `term.refresh(0, rows-1)`. xterm's WebGL renderer only repaints the
 * partial dirty-row range its per-cell change detection computes; after a
 * scroll, cells whose new content equals the on-screen glyph at that
 * position are skipped and the stale glyph persists (worst in tables —
 * repeated spaces / box-drawing borders / aligned columns). A full refresh
 * marks every visible row dirty and repaints. Empirically: a window resize
 * / tab switch (which already force a full refresh) heal the smear today.
 *
 * Behaviour is identical to the established remedy already used post-replay
 * (useReplayDrainGate) and post-resize/tab (useTerminalResize /
 * useTerminalShellEffects); this module wires it to the scroll INPUT, which
 * had no refresh hook.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";

import {
  attachScrollRepaint,
  SCROLL_REPAINT_TRAILING_MS,
} from "./scroll-repaint";

interface MockTermHandle {
  term: Terminal;
  refresh: ReturnType<typeof vi.fn>;
  fireScroll: () => void;
  scrollDispose: ReturnType<typeof vi.fn>;
}

function makeTerm(rows = 24): MockTermHandle {
  let scrollCb: (() => void) | null = null;
  const refresh = vi.fn();
  const scrollDispose = vi.fn();
  const term = {
    rows,
    refresh,
    onScroll: vi.fn((cb: () => void) => {
      scrollCb = cb;
      return { dispose: scrollDispose };
    }),
  } as unknown as Terminal;
  return {
    term,
    refresh,
    scrollDispose,
    fireScroll: () => scrollCb?.(),
  };
}

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

/** A controllable rAF seam: captures callbacks, runs them on demand. */
function makeFrameSeam() {
  const queue: Array<() => void> = [];
  return {
    requestFrame: vi.fn((cb: () => void) => {
      queue.push(cb);
      return queue.length; // 1-based handle
    }),
    cancelFrame: vi.fn(),
    flush() {
      const pending = queue.splice(0);
      for (const cb of pending) cb();
    },
  };
}

/** A controllable timer seam. */
function makeTimerSeam() {
  let captured: (() => void) | null = null;
  return {
    setTimer: vi.fn((cb: () => void) => {
      captured = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimer: vi.fn(),
    fire() {
      captured?.();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("attachScrollRepaint", () => {
  it("registers a term.onScroll handler on attach", () => {
    const { term } = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(term, c, () => false, { ...frame, ...timer });

    expect(term.onScroll).toHaveBeenCalledTimes(1);
  });

  it("firing onScroll schedules a FULL-viewport refresh(0, rows-1)", () => {
    const h = makeTerm(40);
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    h.fireScroll();
    frame.flush();

    expect(h.refresh).toHaveBeenCalledWith(0, 39);
  });

  it("a raw wheel event on the container triggers a full refresh (alt-buffer path)", () => {
    const h = makeTerm(24);
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    c.dispatchEvent(new Event("wheel", { bubbles: true }));
    frame.flush();

    expect(h.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("coalesces multiple triggers within one frame into a single refresh", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    h.fireScroll();
    c.dispatchEvent(new Event("wheel", { bubbles: true }));
    h.fireScroll();

    // Only one frame requested despite three triggers.
    expect(frame.requestFrame).toHaveBeenCalledTimes(1);
    frame.flush();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("schedules a trailing full refresh to catch the async alt-buffer redraw", () => {
    const h = makeTerm(24);
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    c.dispatchEvent(new Event("wheel", { bubbles: true }));

    expect(timer.setTimer).toHaveBeenCalledWith(
      expect.any(Function),
      SCROLL_REPAINT_TRAILING_MS,
    );
    // The trailing timer forces a refresh even without a frame flush.
    timer.fire();
    expect(h.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("never refreshes once the terminal is disposed", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => true, { ...frame, ...timer });
    h.fireScroll();
    frame.flush();
    timer.fire();

    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("disposer removes the wheel listener, disposes onScroll, and cancels pending work", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    const dispose = attachScrollRepaint(h.term, c, () => false, {
      ...frame,
      ...timer,
    });
    // Arm a pending frame + trailing timer.
    h.fireScroll();
    dispose();

    expect(h.scrollDispose).toHaveBeenCalledTimes(1);
    expect(frame.cancelFrame).toHaveBeenCalled();
    expect(timer.clearTimer).toHaveBeenCalled();

    // Post-dispose wheel must not schedule anything new.
    frame.requestFrame.mockClear();
    c.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(frame.requestFrame).not.toHaveBeenCalled();
  });

  it("swallows a refresh throw from a mid-dispose terminal", () => {
    const h = makeTerm();
    (h.refresh as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("renderer disposed");
    });
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    h.fireScroll();
    expect(() => frame.flush()).not.toThrow();
  });
});
