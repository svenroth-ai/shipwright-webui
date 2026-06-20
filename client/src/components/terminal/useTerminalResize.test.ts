/*
 * useTerminalResize — `safeFit` + ResizeObserver/tab-activation unit tests.
 *
 * Visibility/focus repaint + data-driven settle-arm tests live in
 * `useTerminalResize.repaint.test.ts`; the shared FakeRO + renderHook
 * scaffolding lives in `useTerminalResize.test-harness.ts` (split under the
 * 300-LOC guideline — iterate-2026-06-20-split-useterminalresize-test).
 *
 * Covers here:
 *   - `safeFit` short-circuits when disposed OR when renderer dims are zero;
 *     brittleness-guard: missing `_core` falls through to fit.fit().
 *   - ResizeObserver throttle: two callbacks inside the 250 ms window produce
 *     ONE trailing-edge fit; trailing-edge fire after unmount/dispose is a no-op.
 *   - Tab-activation refit calls fit + term.refresh (display:none repair).
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { safeFit } from "./useTerminalResize";
import { installResizeHarness, type ResizeHarness } from "./useTerminalResize.test-harness";

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

// --- useTerminalResize: ResizeObserver + tab activation --------------------

describe("useTerminalResize hook — resize + tab activation", () => {
  let h: ResizeHarness;
  beforeEach(() => {
    h = installResizeHarness();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("ResizeObserver observes the container on mount, disconnects on unmount", () => {
    const { unmount } = h.setup(false);
    expect(h.getROObserve()).toHaveBeenCalledTimes(1);
    unmount();
    expect(h.getRODisconnect()).toHaveBeenCalledTimes(1);
  });

  it("first RO callback fires fit + sends resize frame", () => {
    const { socketSend, fit } = h.setup(false);
    act(() => {
      h.triggerRO();
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(socketSend).toHaveBeenCalledWith({ type: "resize", cols: 80, rows: 24 });
  });

  it("dedupes no-op resize sends (cols/rows unchanged on second fire)", () => {
    const { socketSend } = h.setup(false);
    act(() => {
      h.triggerRO();
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    // Advance past the throttle window so the leading edge can fire again.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      h.triggerRO();
    });
    // Same dims → dedupe.
    expect(socketSend).toHaveBeenCalledTimes(1);
  });

  it("two RO fires inside the 250 ms throttle window produce ONE trailing-edge fit", () => {
    const { fit } = h.setup(false);
    act(() => {
      h.triggerRO();
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    act(() => {
      h.triggerRO(); // inside window — schedules trailing setTimeout
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
    const { socketSend, fit, disposed, rerender } = h.setup(false);
    act(() => {
      h.triggerRO();
    });
    expect(socketSend).toHaveBeenCalledTimes(1);
    act(() => {
      h.triggerRO(); // schedules trailing
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
    const { socketSend, term, fit, rerender } = h.setup(false);
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
    const { socketSend, rerender } = h.setup(true);
    expect(socketSend).toHaveBeenCalledTimes(1);
    rerender(true);
    rerender(true);
    expect(socketSend).toHaveBeenCalledTimes(1);
  });
});
