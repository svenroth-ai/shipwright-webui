/*
 * touch-scroll.alt-buffer.test.ts — real-xterm.js bench tests guarding the
 * buffer-aware touch-scroll routing.
 *
 * History — there are two iterates whose diff this file straddles:
 *
 *   iterate-2026-06-07-fix-touch-scroll-alt-buffer (ADR-131, PR #110):
 *     Empirically proved that `term.scrollLines()` is a no-op inside
 *     DECSET-1049 alt-buffer. Three assertions DOCUMENTED the bug and
 *     passed with broken code on purpose.
 *
 *   iterate-2026-06-07-fix-touch-scroll-pty-keystrokes (this iterate):
 *     Implements buffer-aware routing in attachTouchScroll. The third
 *     assertion is INVERTED here (scrollLines MUST NOT be called in alt-
 *     buffer) and a new assertion is added that the buffer-aware send
 *     callback receives the expected arrow-key escape sequences.
 *
 * The first two assertions are unchanged — they describe xterm.js's own
 * buffer-state machine, not our code.
 */

import { describe, it, expect, vi } from "vitest";
import { Terminal as RealTerminal } from "@xterm/xterm";
import { attachTouchScroll } from "./touch-scroll";

// xterm.js 6.x `term.write(data, cb)` queues the parser; the buffer
// state-machine has NOT advanced when write() returns. Wrap in a Promise
// and await the callback for deterministic assertions.
const writeAsync = (term: RealTerminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, () => resolve()));

describe("alt-screen buffer — xterm.js buffer state-machine (unchanged across both iterates)", () => {
  it("real xterm: DECSET 1049 flips buffer.active.type to 'alternate'", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80, scrollback: 1000 });
    expect(term.buffer.active.type).toBe("normal");
    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");
    await writeAsync(term, "\x1b[?1049l");
    expect(term.buffer.active.type).toBe("normal");
    term.dispose();
  });

  it("real xterm: in the alt-buffer, scrollLines does NOT move viewportY", async () => {
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

describe("alt-screen buffer — buffer-aware routing (iterate-2026-06-07-fix-touch-scroll-pty-keystrokes)", () => {
  // Helper — synthetic touch-event dispatch. Same shape used by the
  // mock-Terminal cohort in touch-scroll.test.ts.
  function fire(
    target: HTMLElement,
    type: "touchstart" | "touchmove" | "touchend",
    touches: ReadonlyArray<{ identifier: number; clientY: number }>,
  ): void {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: touches });
    Object.defineProperty(ev, "changedTouches", { value: touches });
    Object.defineProperty(ev, "targetTouches", { value: touches });
    target.dispatchEvent(ev);
  }

  function setupContainer(): HTMLElement {
    const c = document.createElement("div");
    Object.defineProperty(c, "clientHeight", {
      value: 432,
      configurable: true,
    });
    document.body.appendChild(c);
    return c;
  }

  it("alt-buffer: scrollLines is NOT called; sendData receives Cursor-Down escape × line count (downward pan)", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80 });
    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");

    const scrollSpy = vi.spyOn(term, "scrollLines");
    const sendData = vi.fn<(data: string) => void>();

    const c = setupContainer();
    const dispose = attachTouchScroll(term, c, { sendData });

    // Upward finger drag (clientY 200 → 100, delta = 100 px). With 18 px
    // per line that is 5 lines down (positive sign convention in
    // consumeTouchDelta). In alt-buffer the routing emits Cursor-Down
    // (`\x1b[B`) × 5.
    fire(c, "touchstart", [{ identifier: 1, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 1, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 1, clientY: 100 }]);

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(sendData).toHaveBeenCalled();
    const sent = sendData.mock.calls.map((c) => c[0]).join("");
    expect(sent).toBe("\x1b[B".repeat(5));

    dispose();
    scrollSpy.mockRestore();
    document.body.removeChild(c);
    term.dispose();
  });

  it("alt-buffer: upward pan emits Cursor-Up escape × |line count|", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80 });
    await writeAsync(term, "\x1b[?1049h");

    const scrollSpy = vi.spyOn(term, "scrollLines");
    const sendData = vi.fn<(data: string) => void>();

    const c = setupContainer();
    const dispose = attachTouchScroll(term, c, { sendData });

    // Downward finger drag (clientY 100 → 200, delta = -100). 5 lines up.
    // Routing emits Cursor-Up (`\x1b[A`) × 5.
    fire(c, "touchstart", [{ identifier: 2, clientY: 100 }]);
    fire(c, "touchmove", [{ identifier: 2, clientY: 200 }]);
    fire(c, "touchend", [{ identifier: 2, clientY: 200 }]);

    expect(scrollSpy).not.toHaveBeenCalled();
    const sent = sendData.mock.calls.map((c) => c[0]).join("");
    expect(sent).toBe("\x1b[A".repeat(5));

    dispose();
    scrollSpy.mockRestore();
    document.body.removeChild(c);
    term.dispose();
  });

  it("normal-buffer: scrollLines IS called; sendData is NOT invoked (preserves pre-iterate behavior)", () => {
    const term = new RealTerminal({ rows: 24, cols: 80, scrollback: 1000 });
    expect(term.buffer.active.type).toBe("normal");

    const scrollSpy = vi.spyOn(term, "scrollLines");
    const sendData = vi.fn<(data: string) => void>();

    const c = setupContainer();
    const dispose = attachTouchScroll(term, c, { sendData });

    fire(c, "touchstart", [{ identifier: 3, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 3, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 3, clientY: 100 }]);

    expect(scrollSpy).toHaveBeenCalledWith(5);
    expect(sendData).not.toHaveBeenCalled();

    dispose();
    scrollSpy.mockRestore();
    document.body.removeChild(c);
    term.dispose();
  });

  it("absent sendData callback in alt-buffer is a clean no-op (defensive — no throw, no scrollLines fallback)", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80 });
    await writeAsync(term, "\x1b[?1049h");

    const scrollSpy = vi.spyOn(term, "scrollLines");
    const c = setupContainer();
    // attachTouchScroll(term, c) — no deps, no sendData. Production code
    // path covered until EmbeddedTerminal.tsx is wired (defense-in-depth).
    const dispose = attachTouchScroll(term, c);

    fire(c, "touchstart", [{ identifier: 4, clientY: 200 }]);
    fire(c, "touchmove", [{ identifier: 4, clientY: 100 }]);
    fire(c, "touchend", [{ identifier: 4, clientY: 100 }]);

    // No throw, no scrollLines fallback (would be a no-op in alt-buffer
    // anyway; explicit absence is the cleaner contract).
    expect(scrollSpy).not.toHaveBeenCalled();

    dispose();
    scrollSpy.mockRestore();
    document.body.removeChild(c);
    term.dispose();
  });
});
