/*
 * touch-scroll.test.ts — unit + jsdom-integration tests for the
 * embedded-terminal touch-scroll handler.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  attachTouchScroll,
  consumeTouchDelta,
  createTouchScrollState,
} from "./touch-scroll";

describe("consumeTouchDelta — pure pixel→line accumulator", () => {
  it("returns 0 on sub-line drag and accumulates the remainder", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, 5, 18)).toBe(0);
    expect(s.pixelAccumulator).toBe(5);
    expect(consumeTouchDelta(s, 8, 18)).toBe(0);
    expect(s.pixelAccumulator).toBe(13);
  });

  it("flushes a whole line once the accumulator crosses the line height", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, 20, 18)).toBe(1);
    // 20 - 18 = 2 remaining
    expect(s.pixelAccumulator).toBe(2);
  });

  it("handles upward (negative) drag as a negative line count", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, -20, 18)).toBe(-1);
    expect(s.pixelAccumulator).toBe(-2);
  });

  it("emits multiple lines in a single fast drag", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, 90, 18)).toBe(5);
    expect(s.pixelAccumulator).toBe(0);
  });

  it("returns 0 when pixelsPerLine is non-positive (defensive)", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, 100, 0)).toBe(0);
    expect(consumeTouchDelta(s, 100, -5)).toBe(0);
    // Accumulator must remain untouched so a later proper measurement
    // doesn't see phantom pixels.
    expect(s.pixelAccumulator).toBe(0);
  });

  it("alternating direction in the same gesture cancels accumulated pixels", () => {
    const s = createTouchScrollState();
    expect(consumeTouchDelta(s, 10, 18)).toBe(0);
    expect(consumeTouchDelta(s, -10, 18)).toBe(0);
    expect(s.pixelAccumulator).toBe(0);
  });
});

describe("attachTouchScroll — jsdom integration with synthetic touches", () => {
  function makeTerm(): Terminal {
    return {
      rows: 24,
      scrollLines: vi.fn(),
    } as unknown as Terminal;
  }

  function makeContainer(clientHeight = 432): HTMLElement {
    const c = document.createElement("div");
    Object.defineProperty(c, "clientHeight", {
      value: clientHeight,
      configurable: true,
    });
    document.body.appendChild(c);
    return c;
  }

  function fireTouch(
    target: HTMLElement,
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    touches: ReadonlyArray<{ identifier: number; clientY: number }>,
  ): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: touches });
    Object.defineProperty(ev, "changedTouches", { value: touches });
    Object.defineProperty(ev, "targetTouches", { value: touches });
    target.dispatchEvent(ev);
    return ev;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("multi-touch is ignored (browser owns pinch / etc.)", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [
      { identifier: 0, clientY: 100 },
      { identifier: 1, clientY: 200 },
    ]);
    fireTouch(c, "touchmove", [{ identifier: 0, clientY: 50 }]);
    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it("one-finger upward drag (finger Y decreases) scrolls DOWN", () => {
    const term = makeTerm();
    const c = makeContainer(); // 432 / 24 = 18 px per line
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 7, clientY: 200 }]);
    fireTouch(c, "touchmove", [{ identifier: 7, clientY: 170 }]);
    // delta = 200 - 170 = 30, 30 / 18 = 1.67 → 1 line down + 12 px remainder
    expect(term.scrollLines).toHaveBeenCalledWith(1);
  });

  it("one-finger downward drag scrolls UP by floor(delta/lineHeight)", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 9, clientY: 100 }]);
    fireTouch(c, "touchmove", [{ identifier: 9, clientY: 200 }]);
    // delta = -100, -100 / 18 = -5.55 → -5 lines up + -10 remainder
    expect(term.scrollLines).toHaveBeenCalledWith(-5);
  });

  it("accumulates sub-line moves across consecutive touchmove events", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 3, clientY: 100 }]);
    fireTouch(c, "touchmove", [{ identifier: 3, clientY: 95 }]); // delta=5 → 0 lines
    fireTouch(c, "touchmove", [{ identifier: 3, clientY: 90 }]); // delta=5 → 0 lines (10 total)
    fireTouch(c, "touchmove", [{ identifier: 3, clientY: 80 }]); // delta=10 → 1 line (20 total - 18)
    const scrollLines = term.scrollLines as ReturnType<typeof vi.fn>;
    const totalScrolled = scrollLines.mock.calls.reduce(
      (sum, [n]) => sum + (n as number),
      0,
    );
    expect(totalScrolled).toBe(1);
  });

  it("touchmove with a non-tracked identifier (gesture-changed) is ignored", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 11, clientY: 100 }]);
    fireTouch(c, "touchmove", [{ identifier: 99, clientY: 50 }]);
    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it("touchend resets state so a new gesture starts clean", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 1, clientY: 100 }]);
    fireTouch(c, "touchmove", [{ identifier: 1, clientY: 90 }]); // accumulator=10
    fireTouch(c, "touchend", [{ identifier: 1, clientY: 90 }]);
    // New gesture with a fresh accumulator — a 5-px move must NOT trigger
    // a line because the previous 10 px were dropped.
    fireTouch(c, "touchstart", [{ identifier: 2, clientY: 200 }]);
    fireTouch(c, "touchmove", [{ identifier: 2, clientY: 195 }]);
    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it("touchmove calls preventDefault on the cancelable event", () => {
    const term = makeTerm();
    const c = makeContainer();
    attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 5, clientY: 100 }]);
    const ev = fireTouch(c, "touchmove", [{ identifier: 5, clientY: 50 }]);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("dispose removes every listener", () => {
    const term = makeTerm();
    const c = makeContainer();
    const dispose = attachTouchScroll(term, c);
    fireTouch(c, "touchstart", [{ identifier: 1, clientY: 100 }]);
    dispose();
    fireTouch(c, "touchmove", [{ identifier: 1, clientY: 50 }]);
    expect(term.scrollLines).not.toHaveBeenCalled();
  });

  it("custom getPixelsPerLine seam is consulted on every touchmove", () => {
    const term = makeTerm();
    const c = makeContainer();
    const getPx = vi.fn().mockReturnValue(10);
    attachTouchScroll(term, c, { getPixelsPerLine: getPx });
    fireTouch(c, "touchstart", [{ identifier: 1, clientY: 100 }]);
    fireTouch(c, "touchmove", [{ identifier: 1, clientY: 75 }]); // delta=25
    expect(getPx).toHaveBeenCalled();
    // 25 / 10 = 2.5 → 2 lines down with remainder 5
    expect(term.scrollLines).toHaveBeenCalledWith(2);
  });
});
