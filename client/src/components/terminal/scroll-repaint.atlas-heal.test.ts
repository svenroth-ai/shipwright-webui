/*
 * scroll-repaint.atlas-heal.test.ts — the WebGL glyph-atlas heal on the
 * trailing scroll pass (iterate-2026-07-24-terminal-scroll-atlas-smear).
 *
 * Split from `scroll-repaint.test.ts` (300-LOC guideline), mirroring the
 * sibling `*.atlas-heal.test.*` files for `EmbeddedTerminal` and
 * `useTerminalResize`.
 *
 * RED-test rationale. `term.refresh` — everything scroll-repaint.test.ts pins
 * — routes through `WebglRenderer._updateModel`, which SKIPS cells whose
 * code/fg/bg/ext match the cached model. A cell pointing at a stale glyph-atlas
 * coordinate is therefore dirty-skipped forever, and no amount of refreshing
 * can heal the wrong-letter corruption. Scroll was the LAST repaint path with
 * no `clearTextureAtlas()` wired to it (window refocus and tab activation got
 * theirs in #206/#215), which is exactly why the user's "make the terminal
 * bigger or smaller, then scroll" repro brought the smear straight back.
 *
 * Only relevant to the OPT-IN WebGL arm — the DOM renderer (the default since
 * this iterate) holds no atlas, so `getHealAtlas` returns null there.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";

import { attachScrollRepaint } from "./scroll-repaint";

function makeTerm(rows = 24) {
  let scrollCb: (() => void) | null = null;
  const refresh = vi.fn();
  const term = {
    rows,
    refresh,
    onScroll: vi.fn((cb: () => void) => {
      scrollCb = cb;
      return { dispose: vi.fn() };
    }),
  } as unknown as Terminal;
  return { term, refresh, fireScroll: () => scrollCb?.() };
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
      for (const cb of queue.splice(0)) cb();
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

describe("attachScrollRepaint — WebGL glyph-atlas heal", () => {
  it("heals the atlas on the TRAILING pass when scrolling settles", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();
    const heal = vi.fn();

    attachScrollRepaint(h.term, c, () => false, {
      ...frame,
      ...timer,
      getHealAtlas: () => heal,
    });

    h.fireScroll();
    frame.flush();
    // The per-frame pass must NOT heal: clearTextureAtlas re-rasterises every
    // visible glyph, so once per wheel tick would cost more than it saves.
    expect(heal).not.toHaveBeenCalled();

    timer.fire();
    expect(heal).toHaveBeenCalledTimes(1);
  });

  it("does not heal when the arm has no atlas (DOM renderer — the default)", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, {
      ...frame,
      ...timer,
      getHealAtlas: () => null,
    });

    h.fireScroll();
    frame.flush();
    expect(() => timer.fire()).not.toThrow();
    // Still repaints — the refresh itself is renderer-independent.
    expect(h.refresh).toHaveBeenCalled();
  });

  it("omitting getHealAtlas entirely stays backwards compatible", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();

    attachScrollRepaint(h.term, c, () => false, { ...frame, ...timer });
    h.fireScroll();
    frame.flush();
    expect(() => timer.fire()).not.toThrow();
  });

  it("does not heal once the terminal is disposed", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();
    const heal = vi.fn();
    let disposed = false;

    attachScrollRepaint(h.term, c, () => disposed, {
      ...frame,
      ...timer,
      getHealAtlas: () => heal,
    });

    h.fireScroll();
    // Terminal tears down between the scroll and the trailing timer firing.
    disposed = true;
    timer.fire();

    expect(heal).not.toHaveBeenCalled();
  });

  it("swallows a heal throw from a mid-dispose terminal", () => {
    const h = makeTerm();
    const c = makeContainer();
    const frame = makeFrameSeam();
    const timer = makeTimerSeam();
    const heal = vi.fn(() => {
      throw new Error("renderer disposed");
    });

    attachScrollRepaint(h.term, c, () => false, {
      ...frame,
      ...timer,
      getHealAtlas: () => heal,
    });

    h.fireScroll();
    expect(() => timer.fire()).not.toThrow();
    expect(heal).toHaveBeenCalledTimes(1);
  });
});
