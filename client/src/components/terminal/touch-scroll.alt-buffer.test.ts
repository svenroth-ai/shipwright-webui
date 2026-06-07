/*
 * touch-scroll.alt-buffer.test.ts — bench reproduction of the post-merge
 * regression where touch-pan visibly does nothing while Claude Code's TUI
 * is running.
 *
 * Empirical hypothesis driving iterate-2026-06-07-fix-touch-scroll-alt-buffer:
 *
 *   `term.scrollLines(n)` operates on the normal-buffer scrollback. In the
 *   alternate buffer (Claude Code TUI's render target — CLAUDE.md rule 22 /
 *   ADR-095 default-ON `CLAUDE_CODE_NO_FLICKER=1` / ADR-096 confirms `DECRST
 *   1049` on exit) there IS no scrollback, so the call resolves with no
 *   visible viewport motion. PR #61 (ADR-129) shipped green because the
 *   mock-Terminal pattern in `touch-scroll.test.ts` (`scrollLines: vi.fn()`)
 *   cannot model this.
 *
 * These tests instantiate a REAL `@xterm/xterm` Terminal in jsdom (no
 * `term.open()` — the buffer state-machine runs synchronously on `write()`
 * without needing a renderer) and assert the observed behavior. They
 * DOCUMENT THE CURRENT BUG: they pass with the broken code. When the fix
 * lands (buffer-aware routing of pan-delta to pty keystrokes), these
 * assertions invert into regression guards.
 *
 * Split from `touch-scroll.test.ts` so the original mock-based suite stays
 * under the 300-LOC file-size guideline and the real-xterm cohort lives in
 * its own module (memory: feedback_bloat_retirement_split).
 */

import { describe, it, expect, vi } from "vitest";
import { Terminal as RealTerminal } from "@xterm/xterm";
import { attachTouchScroll } from "./touch-scroll";

// xterm.js 6.x `term.write(data, cb)` queues the parser; the buffer
// state-machine has NOT advanced when write() returns. Wrap in a Promise
// and await the callback for deterministic assertions.
const writeAsync = (term: RealTerminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, () => resolve()));

describe("alt-screen buffer — bench reproduction of the no-op scrollLines bug", () => {
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
    // Normal-buffer baseline: write 50 lines so there IS a scrollback,
    // then prove scrollLines moves the viewport.
    for (let i = 0; i < 50; i++) await writeAsync(term, `line-${i}\r\n`);
    const normalBaseline = term.buffer.active.viewportY;
    term.scrollLines(-10);
    const normalAfter = term.buffer.active.viewportY;
    expect(normalAfter).toBeLessThan(normalBaseline);

    // Enter alt-buffer. By definition it has no scrollback (buffer.length
    // == rows).
    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");
    for (let i = 0; i < 20; i++) await writeAsync(term, `alt-${i}\r\n`);
    const altBaseline = term.buffer.active.viewportY;
    term.scrollLines(-10);
    const altAfter = term.buffer.active.viewportY;
    // The bug: scrollLines was reached but produced no viewport motion.
    expect(altAfter).toBe(altBaseline);
    term.dispose();
  });

  it("attachTouchScroll wired to a real alt-buffer xterm still calls scrollLines (the structural bug)", async () => {
    const term = new RealTerminal({ rows: 24, cols: 80 });
    await writeAsync(term, "\x1b[?1049h");
    expect(term.buffer.active.type).toBe("alternate");

    // Spy-pass-through on the real instance method. The production code
    // reads `term.scrollLines` directly; the touch handler reaches it
    // unconditionally regardless of buffer type — that is the structural
    // defect the follow-up iterate will fix.
    const spy = vi.spyOn(term, "scrollLines");

    const c = document.createElement("div");
    Object.defineProperty(c, "clientHeight", {
      value: 432,
      configurable: true,
    });
    document.body.appendChild(c);

    const dispose = attachTouchScroll(term, c);

    const fire = (
      type: "touchstart" | "touchmove" | "touchend",
      touches: ReadonlyArray<{ identifier: number; clientY: number }>,
    ) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "touches", { value: touches });
      Object.defineProperty(ev, "changedTouches", { value: touches });
      Object.defineProperty(ev, "targetTouches", { value: touches });
      c.dispatchEvent(ev);
    };

    fire("touchstart", [{ identifier: 1, clientY: 200 }]);
    fire("touchmove", [{ identifier: 1, clientY: 100 }]);
    fire("touchend", [{ identifier: 1, clientY: 100 }]);

    // scrollLines was called even though the alt-buffer cannot scroll.
    // When the fix lands (buffer-aware routing → pty keystrokes), invert
    // to `toHaveBeenCalledTimes(0)` here.
    expect(spy).toHaveBeenCalled();

    dispose();
    spy.mockRestore();
    document.body.removeChild(c);
    term.dispose();
  });
});
