/*
 * useTerminalResize — unit tests (Campaign C / C5).
 *
 * Covers:
 *   - `safeFit` short-circuits when disposed OR when renderer dims are zero.
 *   - safeFit brittleness-guard: missing `_core` falls through to fit.fit().
 *   - ResizeObserver throttle: two callbacks inside the 250 ms window
 *     produce ONE trailing-edge fit, not two.
 *   - Trailing-edge fire after unmount is a no-op (Plan-review openai #6).
 *   - Tab-activation refit calls fit + term.refresh (display:none repair).
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { safeFit, useTerminalResize } from "./useTerminalResize";

// --- safeFit ---------------------------------------------------------------

describe("safeFit", () => {
  function makeFitSpy() {
    return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() } as unknown as FitAddon;
  }
  function makeTerm(
    coreDims?: { cellW: number; cellH: number } | null,
  ): Terminal {
    const stub: Record<string, unknown> = { cols: 80, rows: 24 };
    if (coreDims === null) {
      // Caller explicitly wants NO `_core` — for the brittleness-guard test.
      // No-op.
    } else if (coreDims) {
      stub._core = {
        _renderService: {
          dimensions: {
            css: { cell: { width: coreDims.cellW, height: coreDims.cellH } },
          },
        },
      };
    } else {
      // Default — renderer present with sane dims.
      stub._core = {
        _renderService: {
          dimensions: { css: { cell: { width: 7, height: 14 } } },
        },
      };
    }
    return stub as unknown as Terminal;
  }

  it("returns false when disposed=true (never touches fit)", () => {
    const fit = makeFitSpy();
    const term = makeTerm();
    expect(safeFit(fit, term, true)).toBe(false);
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns false when fit OR term is null (defensive guard)", () => {
    const fit = makeFitSpy();
    const term = makeTerm();
    expect(safeFit(null, term, false)).toBe(false);
    expect(safeFit(fit, null, false)).toBe(false);
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns false when renderer reports zero cell dims (pre-renderer-ready)", () => {
    const fit = makeFitSpy();
    expect(safeFit(fit, makeTerm({ cellW: 0, cellH: 14 }), false)).toBe(false);
    expect(safeFit(fit, makeTerm({ cellW: 7, cellH: 0 }), false)).toBe(false);
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns true and invokes fit() when dims are valid", () => {
    const fit = makeFitSpy();
    const term = makeTerm();
    expect(safeFit(fit, term, false)).toBe(true);
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("brittleness-guard: missing `_core` falls through to fit.fit() (does NOT short-circuit)", () => {
    const fit = makeFitSpy();
    const term = makeTerm(null);
    expect(safeFit(fit, term, false)).toBe(true);
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("catches an async-tail throw inside fit() and returns false (no crash)", () => {
    const term = makeTerm();
    const fit = {
      fit: vi.fn(() => {
        throw new TypeError(
          "Cannot read properties of undefined (reading 'dimensions')",
        );
      }),
      activate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as FitAddon;
    expect(safeFit(fit, term, false)).toBe(false);
  });
});

// --- useTerminalResize -----------------------------------------------------

describe("useTerminalResize hook", () => {
  // jsdom doesn't ship ResizeObserver. Capture the most-recent constructor
  // arg + expose a manual trigger so tests can drive the throttle.
  let lastROCallback: (() => void) | null = null;
  let lastRODisconnect: ReturnType<typeof vi.fn> | null = null;
  let lastROObserve: ReturnType<typeof vi.fn> | null = null;

  class FakeRO {
    constructor(cb: () => void) {
      lastROCallback = cb;
    }
    observe = (lastROObserve = vi.fn());
    unobserve = vi.fn();
    disconnect = (lastRODisconnect = vi.fn());
  }

  function makeTerm(): Terminal {
    return {
      cols: 80,
      rows: 24,
      refresh: vi.fn(),
      _core: {
        _renderService: {
          dimensions: { css: { cell: { width: 7, height: 14 } } },
        },
      },
    } as unknown as Terminal;
  }

  function makeFit(): FitAddon {
    return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() } as unknown as FitAddon;
  }

  beforeEach(() => {
    lastROCallback = null;
    lastROObserve = null;
    lastRODisconnect = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function setup(
    initialActive: boolean,
  ): {
    socketSend: ReturnType<typeof vi.fn>;
    settleArm: ReturnType<typeof vi.fn>;
    term: Terminal;
    fit: FitAddon;
    disposed: { current: boolean };
    rerender: (active: boolean) => void;
    unmount: () => void;
  } {
    const socketSend = vi.fn();
    const settleArm = vi.fn();
    const term = makeTerm();
    const fit = makeFit();
    const disposed = { current: false };
    const container = document.createElement("div");

    const { rerender, unmount } = renderHook(
      (props: { active: boolean }) => {
        const containerRef = useRef<HTMLDivElement | null>(container);
        const termRef = useRef<Terminal | null>(term);
        const fitAddonRef = useRef<FitAddon | null>(fit);
        const disposedRef = useRef<boolean>(disposed.current);
        const settleArmRef = useRef<(() => void) | null>(settleArm);
        // Sync the disposed flag into the ref the hook sees.
        disposedRef.current = disposed.current;
        useTerminalResize({
          containerRef,
          termRef,
          fitAddonRef,
          disposedRef,
          socketSend,
          active: props.active,
          settleArmRef,
        });
      },
      { initialProps: { active: initialActive } },
    );

    return {
      socketSend,
      settleArm,
      term,
      fit,
      disposed,
      rerender: (active: boolean) => rerender({ active }),
      unmount,
    };
  }

  it("ResizeObserver observes the container on mount, disconnects on unmount", () => {
    const { unmount } = setup(false);
    expect(lastROObserve).toHaveBeenCalledTimes(1);
    unmount();
    expect(lastRODisconnect).toHaveBeenCalledTimes(1);
  });

  it("first RO callback fires fit + sends resize frame", () => {
    const { socketSend, fit } = setup(false);
    act(() => {
      lastROCallback?.();
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(socketSend).toHaveBeenCalledWith({ type: "resize", cols: 80, rows: 24 });
  });

  it("dedupes no-op resize sends (cols/rows unchanged on second fire)", () => {
    const { socketSend } = setup(false);
    act(() => {
      lastROCallback?.();
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    // Advance past the throttle window so the leading edge can fire again.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      lastROCallback?.();
    });
    // Same dims → dedupe.
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it("two RO fires inside the 250 ms throttle window produce ONE trailing-edge fit", () => {
    const { fit } = setup(false);
    act(() => {
      lastROCallback?.();
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    act(() => {
      lastROCallback?.(); // inside window — schedules trailing setTimeout
    });
    // Trailing edge has not fired yet.
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    // Fire the trailing edge.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("trailing-edge fire after disposed=true is a no-op (Plan-review openai #6)", () => {
    const { socketSend, fit, disposed, rerender } = setup(false);
    act(() => {
      lastROCallback?.();
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    act(() => {
      lastROCallback?.(); // schedules trailing
    });
    // Flip disposed BEFORE the trailing-edge timer expires.
    disposed.current = true;
    rerender(false); // re-render so the hook's disposedRef picks up the flip
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // No extra fit / send fired post-disposal.
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it("tab activation (active false→true) triggers refit AND term.refresh + a resize frame", () => {
    const { socketSend, term, fit, rerender } = setup(false);
    // active=false initially — no refit yet.
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    rerender(true);
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      0,
      term.rows - 1,
    );
    expect(socketSend).toHaveBeenCalledWith({
      type: "resize",
      cols: 80,
      rows: 24,
    });
  });

  it("tab stays active across re-renders with unchanged dims: no duplicate resize frames", () => {
    const { socketSend, rerender } = setup(true);
    expect(socketSend).toHaveBeenCalledTimes(1);
    rerender(true);
    rerender(true);
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  // --- visibility / focus / bfcache repaint (smear-on-window-refocus fix) ---
  // The WebGL renderer only force-repaints on ResizeObserver, tab activation,
  // and scroll. When the browser WINDOW/TAB regains visibility or focus
  // (returning to Edge after it was backgrounded, monitor switch, or a
  // bfcache restore) Chromium may have stopped painting / dropped the WebGL
  // canvas while hidden — leaving a STALE frame ("smear") that nothing
  // refits. These tests pin the new refit + full-viewport refresh wiring.

  function setHidden(value: boolean): void {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => value,
    });
  }

  it("window focus triggers refit + term.refresh + a resize frame", () => {
    const { socketSend, term, fit } = setup(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      0,
      term.rows - 1,
    );
    expect(socketSend).toHaveBeenCalledWith({
      type: "resize",
      cols: 80,
      rows: 24,
    });
  });

  it("document visibilitychange (becoming visible) triggers refit + term.refresh", () => {
    setHidden(false);
    const { term, fit } = setup(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("pageshow (bfcache restore) triggers refit + term.refresh", () => {
    const { term, fit } = setup(false);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("visibilitychange while document.hidden=true is a no-op", () => {
    const { term, fit } = setup(false);
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    setHidden(false);
  });

  it("focus after disposed=true is a no-op (no fit/refresh on a dead term)", () => {
    const { term, fit, disposed, rerender } = setup(false);
    disposed.current = true;
    rerender(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("removes the focus/visibility/pageshow listeners on unmount", () => {
    const { term, fit, unmount } = setup(false);
    unmount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("focus with unchanged dims still repaints but dedupes the resize frame", () => {
    const { socketSend, term, fit } = setup(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    // Second focus, same dims → no duplicate SIGWINCH, but a fresh repaint.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  // --- data-driven settle-repaint arming (iterate-2026-06-20 AC-4) ---
  // The fixed 130/350 ms trailing repaints are RETIRED; the post-layout-change
  // repaint is now reactive (repaint-on-settle.ts) so a slow mobile async
  // redraw still gets repainted. This hook ARMS that window on tab-activation
  // + visibility/focus; resize-driven arming is the settle module's own
  // `term.onResize`, so the RO path here arms nothing. The synchronous
  // immediate `term.refresh` (display:none / stale-frame repair) is retained
  // and is covered by the activation / focus / visibility tests above.

  it("tab activation arms the settle-repaint window", () => {
    const { settleArm, rerender } = setup(false);
    expect(settleArm).not.toHaveBeenCalled();
    rerender(true);
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("activation arms even when dims are unchanged (same-pane Transcript→Terminal toggle)", () => {
    // The pane keeps its size across the inner tab toggle → no SIGWINCH, but a
    // late async redraw can still smear, so the window MUST arm anyway.
    const { settleArm, rerender } = setup(true); // active from mount → 1 arm
    expect(settleArm).toHaveBeenCalledTimes(1);
    rerender(false);
    rerender(true); // re-activate, dims identical
    expect(settleArm).toHaveBeenCalledTimes(2);
  });

  it("window focus arms the settle-repaint window", () => {
    const { settleArm } = setup(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange (becoming visible) arms the settle-repaint window", () => {
    setHidden(false);
    const { settleArm } = setup(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("pageshow (bfcache restore) arms the settle-repaint window", () => {
    const { settleArm } = setup(false);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("a hidden visibilitychange does NOT arm (no work while hidden)", () => {
    const { settleArm } = setup(false);
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(settleArm).not.toHaveBeenCalled();
    setHidden(false);
  });

  it("the RO (resize) path does NOT arm here — the settle module's own onResize does", () => {
    const { settleArm } = setup(false);
    act(() => {
      lastROCallback?.();
    });
    expect(settleArm).not.toHaveBeenCalled();
  });

  it("focus after disposal does not arm (guarded by disposedRef)", () => {
    const { settleArm, disposed, rerender } = setup(false);
    disposed.current = true;
    rerender(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settleArm).not.toHaveBeenCalled();
  });
});
