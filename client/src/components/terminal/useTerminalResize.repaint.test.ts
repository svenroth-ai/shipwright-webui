/*
 * useTerminalResize — visibility/focus/bfcache repaint + data-driven
 * settle-arm tests.
 *
 * Split from `useTerminalResize.test.ts` (which keeps safeFit +
 * ResizeObserver/tab-activation) under the 300-LOC guideline
 * (iterate-2026-06-20-split-useterminalresize-test); shared FakeRO +
 * renderHook scaffolding in `useTerminalResize.test-harness.ts`.
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installResizeHarness,
  setHidden,
  type ResizeHarness,
} from "./useTerminalResize.test-harness";
import { ACTIVATION_REPAINT_DELAYS_MS } from "./activation-repaint";

const PAST_LAST_DELAY_MS =
  ACTIVATION_REPAINT_DELAYS_MS[ACTIVATION_REPAINT_DELAYS_MS.length - 1] + 10;

// --- visibility / focus / bfcache repaint (smear-on-window-refocus fix) ---
// The WebGL renderer only force-repaints on ResizeObserver, tab activation, and
// scroll. When the browser WINDOW/TAB regains visibility or focus (returning to
// Edge after it was backgrounded, monitor switch, or a bfcache restore)
// Chromium may have stopped painting / dropped the WebGL canvas while hidden —
// leaving a STALE frame ("smear") that nothing refits. These tests pin the
// refit + full-viewport refresh wiring, and (iterate-2026-06-20 AC-4) the
// data-driven settle-arm that the fixed 130/350 ms trailing repaints were
// retired in favour of (the reactive repaint lives in repaint-on-settle.ts;
// this hook only ARMS it on tab-activation + visibility/focus).

describe("useTerminalResize hook — repaint + settle-arm", () => {
  let h: ResizeHarness;
  beforeEach(() => {
    h = installResizeHarness();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("window focus triggers refit + term.refresh + a resize frame", () => {
    const { socketSend, term, fit } = h.setup(false);
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
    const { term, fit } = h.setup(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("pageshow (bfcache restore) triggers refit + term.refresh", () => {
    const { term, fit } = h.setup(false);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("visibilitychange while document.hidden=true is a no-op", () => {
    const { term, fit } = h.setup(false);
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    setHidden(false);
  });

  it("focus after disposed=true is a no-op (no fit/refresh on a dead term)", () => {
    const { term, fit, disposed, rerender } = h.setup(false);
    disposed.current = true;
    rerender(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect((fit.fit as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((term.refresh as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("removes the focus/visibility/pageshow listeners on unmount", () => {
    const { term, fit, unmount } = h.setup(false);
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
    const { socketSend, term, fit } = h.setup(false);
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
  // This hook ARMS the settle window on tab-activation + visibility/focus;
  // resize-driven arming is the settle module's own `term.onResize`, so the RO
  // path here arms nothing. The synchronous immediate `term.refresh`
  // (display:none / stale-frame repair) is retained and covered above.

  it("tab activation arms the settle-repaint window", () => {
    const { settleArm, rerender } = h.setup(false);
    expect(settleArm).not.toHaveBeenCalled();
    rerender(true);
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("activation arms even when dims are unchanged (same-pane Transcript→Terminal toggle)", () => {
    // The pane keeps its size across the inner tab toggle → no SIGWINCH, but a
    // late async redraw can still smear, so the window MUST arm anyway.
    const { settleArm, rerender } = h.setup(true); // active from mount → 1 arm
    expect(settleArm).toHaveBeenCalledTimes(1);
    rerender(false);
    rerender(true); // re-activate, dims identical
    expect(settleArm).toHaveBeenCalledTimes(2);
  });

  it("window focus arms the settle-repaint window", () => {
    const { settleArm } = h.setup(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange (becoming visible) arms the settle-repaint window", () => {
    setHidden(false);
    const { settleArm } = h.setup(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("pageshow (bfcache restore) arms the settle-repaint window", () => {
    const { settleArm } = h.setup(false);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(settleArm).toHaveBeenCalledTimes(1);
  });

  it("a hidden visibilitychange does NOT arm (no work while hidden)", () => {
    const { settleArm } = h.setup(false);
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(settleArm).not.toHaveBeenCalled();
    setHidden(false);
  });

  it("the RO (resize) path does NOT arm here — the settle module's own onResize does", () => {
    const { settleArm } = h.setup(false);
    act(() => {
      h.triggerRO();
    });
    expect(settleArm).not.toHaveBeenCalled();
  });

  it("focus after disposal does not arm (guarded by disposedRef)", () => {
    const { settleArm, disposed, rerender } = h.setup(false);
    disposed.current = true;
    rerender(false);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(settleArm).not.toHaveBeenCalled();
  });

  // --- data-INDEPENDENT activation repaints (iterate-2026-06-22 idle smear) ---
  // The settle window only repaints on writes; an IDLE Transcript→Terminal
  // switch (Claude parked at a prompt) emits none, so the single synchronous
  // refresh is all that fires — and it lands before the un-hidden WebGL canvas
  // is composited. These deferred passes (activation-repaint.ts) MUST fire
  // regardless of data flow. Pre-fix: nothing schedules them → the count never
  // grows past the synchronous refresh.

  it("tab activation schedules data-independent trailing repaints (idle, no writes)", () => {
    const { term, rerender } = h.setup(false);
    const refresh = term.refresh as ReturnType<typeof vi.fn>;
    rerender(true); // activate
    const afterSync = refresh.mock.calls.length; // synchronous activation refresh
    act(() => {
      vi.advanceTimersByTime(PAST_LAST_DELAY_MS);
    });
    expect(refresh.mock.calls.length).toBe(
      afterSync + ACTIVATION_REPAINT_DELAYS_MS.length,
    );
    expect(refresh).toHaveBeenCalledWith(0, term.rows - 1);
  });

  it("window focus schedules data-independent trailing repaints", () => {
    const { term } = h.setup(false);
    const refresh = term.refresh as ReturnType<typeof vi.fn>;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    const afterSync = refresh.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(PAST_LAST_DELAY_MS);
    });
    expect(refresh.mock.calls.length).toBe(
      afterSync + ACTIVATION_REPAINT_DELAYS_MS.length,
    );
  });

  it("trailing repaints are cancelled on unmount (no fire after teardown)", () => {
    const { term, rerender, unmount } = h.setup(false);
    rerender(true);
    const refresh = term.refresh as ReturnType<typeof vi.fn>;
    const before = refresh.mock.calls.length;
    unmount();
    act(() => {
      vi.advanceTimersByTime(PAST_LAST_DELAY_MS);
    });
    expect(refresh.mock.calls.length).toBe(before);
  });
});
