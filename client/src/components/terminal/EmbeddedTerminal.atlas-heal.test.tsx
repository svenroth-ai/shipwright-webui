/*
 * EmbeddedTerminal — the glyph-atlas heal, wired END TO END on the real
 * component (iterate-2026-07-14-terminal-atlas-heal-on-refocus, FR-01.28).
 *
 * WHY A SEPARATE COMPONENT TEST (code-review MED-2). The other suites each own
 * one half of the seam and would BOTH stay green if the wiring were deleted:
 *   - useTerminalResize.atlas-heal.test.ts injects its own heal spy via the
 *     harness ref (proves the hook fires it, not that anything supplies it);
 *   - xtermAddons.atlas.test.ts calls `handle.healAtlas()` directly (proves the
 *     fence clears, not that anyone calls it).
 * The two lines that JOIN them — `atlasHealRef.current = handle.healAtlas` and
 * `atlasHealRef` passed into `useTerminalResize` — had no CI coverage at all,
 * and the Playwright proof (e2e spec 94) is not a CI gate. This file closes
 * that: mount the real component, return to the window, and assert the real
 * `term.clearTextureAtlas()` runs. It is the test that fails for the NAMED root
 * cause ("nothing on the re-show path clears the atlas") on the real component.
 *
 * New file rather than an addition to EmbeddedTerminal.test.tsx: that one is
 * bloat-baselined at 1746 lines, so growing it would trip the anti-ratchet hook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

// --- xterm doubles -------------------------------------------------------
// The WebGL fake MUST carry onContextLoss + the two atlas-mutation events, or
// `attachWebglAtlasRepaint` throws and `createEmbeddedXterm` silently falls into
// its DOM-renderer arm (where there is no atlas and no heal) — which is exactly
// what the pre-existing EmbeddedTerminal.test.tsx WebglAddon mock does.
const clearTextureAtlasSpy = vi.fn();
const refreshSpy = vi.fn();
let mockTermElement: HTMLDivElement | null = null;

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const el = document.createElement("div");
    el.tabIndex = -1;
    document.body.appendChild(el);
    mockTermElement = el;
    return {
      cols: 120,
      rows: 30,
      element: el,
      write: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      clear: vi.fn(),
      reset: vi.fn(),
      refresh: refreshSpy,
      clearTextureAtlas: clearTextureAtlasSpy,
      scrollToBottom: vi.fn(),
      loadAddon: vi.fn(),
      open: vi.fn(),
      onScroll: vi.fn(() => ({ dispose: vi.fn() })),
      onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn(),
      parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      hasSelection: () => false,
      getSelection: () => "",
      clearSelection: vi.fn(),
      paste: vi.fn(),
      buffer: { active: { cursorY: 0, viewportY: 0, length: 0 } },
      // The renderer reports real cell dims, so `safeFit` does not short-circuit.
      _core: { _renderService: { dimensions: { css: { cell: { width: 7, height: 14 } } } } },
    };
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return {
      activate: vi.fn(),
      dispose: vi.fn(),
      onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
      onChangeTextureAtlas: vi.fn(() => ({ dispose: vi.fn() })),
      onAddTextureAtlasCanvas: vi.fn(() => ({ dispose: vi.fn() })),
      onRemoveTextureAtlasCanvas: vi.fn(() => ({ dispose: vi.fn() })),
    };
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { EmbeddedTerminal } from "./EmbeddedTerminal";
import { ACTIVATION_REPAINT_DELAYS_MS } from "./activation-repaint";

/** One clear per trailing pass — the heal rides every pass, not just the last. */
const CLEARS_PER_RESHOW = ACTIVATION_REPAINT_DELAYS_MS.length;

/**
 * Run the trailing passes the way the browser does: each pass is its own
 * macrotask, with the microtask queue drained in between. That matters — the
 * #206 fence coalesces on a microtask, so advancing both timers inside ONE tick
 * would collapse the two heals into one and the test would pass for the wrong
 * reason (it did, before this was fixed).
 */
async function settleTrailingPasses(): Promise<void> {
  let elapsed = 0;
  for (const delay of ACTIVATION_REPAINT_DELAYS_MS) {
    const step = delay - elapsed;
    elapsed = delay;
    await act(async () => {
      vi.advanceTimersByTime(step);
      await Promise.resolve(); // the fence clears on a microtask
    });
  }
  await act(async () => {
    vi.advanceTimersByTime(10); // past the last pass
    await Promise.resolve();
  });
}

describe("EmbeddedTerminal — glyph-atlas heal is wired to the live terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
      class RO {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
    }
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(async () => new Response("{}", { status: 200 })),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockTermElement?.remove();
    mockTermElement = null;
    vi.clearAllMocks();
  });

  it("a window re-show clears the texture atlas on the real xterm instance", async () => {
    render(<EmbeddedTerminal taskId="t1" active socketEnabled={false} />);
    await act(async () => {});
    // Drain anything the mount scheduled, so this test observes only its own
    // trigger. (On first mount the hook's effects run BEFORE the xterm
    // mount-effect, so `termRef` is still null and the activation pass
    // early-returns — but do not rely on that here.)
    await settleTrailingPasses();
    clearTextureAtlasSpy.mockClear();

    // …now the reported flow: the user returns to the window.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    // Not synchronously — the canvas has not composited yet (plan-review MED-2).
    expect(clearTextureAtlasSpy).not.toHaveBeenCalled();

    await settleTrailingPasses();
    expect(clearTextureAtlasSpy).toHaveBeenCalledTimes(CLEARS_PER_RESHOW);
  });

  it("activating the Terminal tab clears the texture atlas (AC-1b)", async () => {
    const { rerender } = render(
      <EmbeddedTerminal taskId="t1" active={false} socketEnabled={false} />,
    );
    await act(async () => {});
    await settleTrailingPasses();
    clearTextureAtlasSpy.mockClear();

    rerender(<EmbeddedTerminal taskId="t1" active socketEnabled={false} />);
    await settleTrailingPasses();
    expect(clearTextureAtlasSpy).toHaveBeenCalledTimes(CLEARS_PER_RESHOW);
  });

  it("a window re-show while the Terminal tab is HIDDEN does not clear (nothing composited)", async () => {
    // TaskDetailPage keeps this component mounted behind `display:none`, so a
    // heal here would re-raster into a canvas that is never composited — wasted.
    // The tab-activation pass heals instead, once the canvas is actually shown.
    render(<EmbeddedTerminal taskId="t1" active={false} socketEnabled={false} />);
    await act(async () => {});
    await settleTrailingPasses();
    clearTextureAtlasSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settleTrailingPasses();
    expect(clearTextureAtlasSpy).not.toHaveBeenCalled();
  });

  it("does not clear after unmount (no heal on a torn-down terminal)", async () => {
    const { unmount } = render(
      <EmbeddedTerminal taskId="t1" active socketEnabled={false} />,
    );
    await act(async () => {});
    await settleTrailingPasses();
    clearTextureAtlasSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    unmount();
    await settleTrailingPasses();
    expect(clearTextureAtlasSpy).not.toHaveBeenCalled();
  });
});
