/*
 * touch-scroll.alt-buffer.test.ts — buffer-aware touch-scroll routing.
 *
 * Two cohorts:
 *
 *   1. Real-`@xterm/xterm` bench (no renderer) pinning the buffer-state
 *      FACTS that justify the routing: DECSET 1049 flips the active buffer
 *      to "alternate", and `scrollLines` is a no-op there (no scrollback).
 *      That is *why* the alt-buffer must route somewhere other than
 *      `scrollLines`.
 *
 *   2. Mock-Terminal-with-element routing tests (ADR-133,
 *      iterate-2026-06-15-touch-scroll-wheel-events; amended
 *      iterate-2026-06-20 AC-3). Routing is buffer-first: the alt-screen
 *      buffer dispatches `WheelEvent`s onto `term.element` (no scrollback to
 *      pan); the normal buffer pans the scrollback via `scrollLines` EVEN
 *      when mouse-tracking is on (the resume-picker fix — the wheel
 *      mouse-report the app ignored). The mock-element pattern mirrors
 *      EmbeddedTerminal.test's controllable `.enable-mouse-events` element;
 *      the byte-level encoding is xterm's own job and is verified end-to-end
 *      by iPad UAT.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Terminal as RealTerminal } from "@xterm/xterm";
import type { Terminal } from "@xterm/xterm";
import { attachTouchScroll } from "./touch-scroll";

// xterm.js 6.x `term.write(data, cb)` queues the parser; the buffer
// state-machine has NOT advanced when write() returns. Wrap in a Promise
// and await the callback for deterministic assertions.
const writeAsync = (term: RealTerminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, () => resolve()));

describe("alt-screen buffer — xterm.js buffer state-machine (real @xterm/xterm)", () => {
  it("real xterm: DECSET 1049 flips buffer.active.type to 'alternate'", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80, scrollback: 1000 });
    expect(term.buffer.active.type).toBe("normal");
    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");
    await writeAsync(term, "\x1b[?1049l");
    expect(term.buffer.active.type).toBe("normal");
    term.dispose();
  });

  it("real xterm: in the alt-buffer, scrollLines does NOT move viewportY (why we route to the wheel instead)", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80, scrollback: 1000 });
    for (let i = 0; i < 50; i++) await writeAsync(term, `line-${i}\r\n`);
    const normalBaseline = term.buffer.active.viewportY;
    term.scrollLines(-10);
    const normalAfter = term.buffer.active.viewportY;
    expect(normalAfter).toBeLessThan(normalBaseline);

    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");
    for (let i = 0; i < 20; i++) await writeAsync(term, `alt-${i}\r\n`);
    const altBaseline = term.buffer.active.viewportY;
    term.scrollLines(-10);
    const altAfter = term.buffer.active.viewportY;
    expect(altAfter).toBe(altBaseline);
    term.dispose();
  });
});

describe("buffer-aware routing — wheel replication (ADR-133)", () => {
  // Synthetic touch-event dispatch. `clientX` is optional so a test can
  // assert the finger position flows through to the WheelEvent coords.
  function fire(
    target: HTMLElement,
    type: "touchstart" | "touchmove" | "touchend",
    touches: ReadonlyArray<{ identifier: number; clientY: number; clientX?: number }>,
  ): void {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: touches });
    Object.defineProperty(ev, "changedTouches", { value: touches });
    Object.defineProperty(ev, "targetTouches", { value: touches });
    target.dispatchEvent(ev);
  }

  function setupContainer(): HTMLElement {
    const c = document.createElement("div");
    // 432 / 24 rows = 18 px per line (defaultPixelsPerLine fallback).
    Object.defineProperty(c, "clientHeight", { value: 432, configurable: true });
    document.body.appendChild(c);
    return c;
  }

  // Mock term exposing a real `element` (so the wheel-dispatch target and the
  // `.enable-mouse-events` gate are observable), a controllable active buffer
  // type, and a spied `scrollLines`. Mirrors EmbeddedTerminal.test's pattern.
  function setupTerm(bufferType: "normal" | "alternate", mouseActive: boolean) {
    const element = document.createElement("div");
    if (mouseActive) element.classList.add("enable-mouse-events");
    document.body.appendChild(element);
    const wheelEvents: WheelEvent[] = [];
    element.addEventListener("wheel", (e) => wheelEvents.push(e as WheelEvent));
    const scrollLines = vi.fn();
    const term = {
      rows: 24,
      element,
      scrollLines,
      buffer: { active: { type: bufferType } },
    } as unknown as Terminal;
    return { term, element, wheelEvents, scrollLines };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("alt-buffer: forwards the pixel delta as a wheel event on term.element (NOT scrollLines, NOT arrow keys) — downward pan → deltaY > 0", () => {
    const { term, wheelEvents, scrollLines } = setupTerm("alternate", false);
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    // Upward finger drag (clientY 200 → 100) ⇒ scroll DOWN. One touchmove ⇒
    // one pixel-mode wheel carrying the raw +100 px delta (xterm self-tunes).
    fire(c, "touchstart", [{ identifier: 1, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 1, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 1, clientY: 100 }]);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(wheelEvents).toHaveLength(1);
    expect(wheelEvents[0].deltaY).toBe(100);
    expect(wheelEvents[0].deltaMode).toBe(0); // DOM_DELTA_PIXEL — trackpad parity

    dispose();
  });

  it("alt-buffer: upward pan forwards a negative-deltaY wheel event", () => {
    const { term, wheelEvents, scrollLines } = setupTerm("alternate", false);
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    // Downward finger drag (clientY 100 → 200) ⇒ scroll UP ⇒ deltaY -100.
    fire(c, "touchstart", [{ identifier: 2, clientY: 100 }]);
    fire(c, "touchmove", [{ identifier: 2, clientY: 200 }]);
    fire(c, "touchend", [{ identifier: 2, clientY: 200 }]);

    expect(scrollLines).not.toHaveBeenCalled();
    expect(wheelEvents).toHaveLength(1);
    expect(wheelEvents[0].deltaY).toBe(-100);

    dispose();
  });

  it("normal buffer WITH mouse tracking: pans the scrollback via scrollLines, NOT a wheel (resume-picker fix — iterate-2026-06-20 AC-3)", () => {
    // ADR-133 originally forwarded normal-buffer + mouse-tracking to a wheel
    // on the theory the app consumes the mouse-report as scroll. Claude's
    // `--resume` "load full session / summary" picker is exactly this surface
    // (normal buffer + mouse-tracking) and IGNORES the wheel report, so a
    // finger-pan did nothing (user report 2026-06-20). The scrollback is the
    // natural touch target there, so we now pan it with scrollLines.
    const { term, wheelEvents, scrollLines } = setupTerm("normal", true);
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    fire(c, "touchstart", [{ identifier: 3, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 3, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 3, clientY: 100 }]);

    expect(wheelEvents).toHaveLength(0);
    // 100 px upward drag / 18 px-per-line (432/24) → 5 lines down.
    expect(scrollLines).toHaveBeenCalledWith(5);

    dispose();
  });

  it("normal buffer, no mouse tracking: scrollLines IS called, NO wheel dispatched (scrollback path preserved)", () => {
    const { term, wheelEvents, scrollLines } = setupTerm("normal", false);
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    fire(c, "touchstart", [{ identifier: 4, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 4, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 4, clientY: 100 }]);

    expect(scrollLines).toHaveBeenCalledWith(5);
    expect(wheelEvents).toHaveLength(0);

    dispose();
  });

  it("the finger position flows through to the WheelEvent coordinates (xterm reports the cell under the finger)", () => {
    const { term, wheelEvents } = setupTerm("alternate", true);
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    fire(c, "touchstart", [{ identifier: 5, clientX: 321, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 5, clientX: 321, clientY: 182 }]); // 18 px delta
    fire(c, "touchend", [{ identifier: 5, clientX: 321, clientY: 182 }]);

    expect(wheelEvents).toHaveLength(1);
    expect(wheelEvents[0].deltaY).toBe(18);
    expect(wheelEvents[0].clientX).toBe(321);
    expect(wheelEvents[0].clientY).toBe(182);

    dispose();
  });

  it("term.element absent (pre-open) is a defensive no-op fallback to scrollLines — never a throw", () => {
    const scrollLines = vi.fn();
    const term = {
      rows: 24,
      scrollLines,
      buffer: { active: { type: "alternate" } },
    } as unknown as Terminal;
    const c = setupContainer();
    const dispose = attachTouchScroll(term, c);

    expect(() => {
      fire(c, "touchstart", [{ identifier: 6, clientY: 200 }]);
      fire(c, "touchmove", [{ identifier: 6, clientY: 100 }]);
      fire(c, "touchend", [{ identifier: 6, clientY: 100 }]);
    }).not.toThrow();
    // No element to dispatch onto → falls back to scrollLines (a no-op in a
    // real alt-buffer, but never a crash).
    expect(scrollLines).toHaveBeenCalledWith(5);

    dispose();
  });
});
