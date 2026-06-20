/*
 * repaint-on-settle.test — data-driven settle-repaint (iterate-2026-06-20
 * AC-4). Fake term emits onWriteParsed/onResize; setTimeout/clearTimeout are
 * driven by vi fake timers; requestAnimationFrame is a manual queue so a
 * write-burst → single coalesced refresh is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  attachSettleRepaint,
  SETTLE_QUIET_MS,
  SETTLE_MAX_MS,
} from "./repaint-on-settle";

function makeHarness() {
  const writeCbs: Array<() => void> = [];
  const resizeCbs: Array<() => void> = [];
  const refresh = vi.fn();
  const term = {
    rows: 24,
    refresh,
    onWriteParsed: (cb: () => void) => {
      writeCbs.push(cb);
      return {
        dispose: () => {
          const i = writeCbs.indexOf(cb);
          if (i >= 0) writeCbs.splice(i, 1);
        },
      };
    },
    onResize: (cb: () => void) => {
      resizeCbs.push(cb);
      return {
        dispose: () => {
          const i = resizeCbs.indexOf(cb);
          if (i >= 0) resizeCbs.splice(i, 1);
        },
      };
    },
  } as unknown as Terminal;

  // Manual frame queue (so coalescing is observable).
  let pendingFrame: (() => void) | null = null;
  const requestFrame = (cb: () => void): number => {
    pendingFrame = cb;
    return 1;
  };
  const cancelFrame = (): void => {
    pendingFrame = null;
  };
  const flushFrame = (): void => {
    const f = pendingFrame;
    pendingFrame = null;
    f?.();
  };

  return {
    term,
    refresh,
    deps: { requestFrame, cancelFrame },
    emitWrite: () => writeCbs.slice().forEach((c) => c()),
    emitResize: () => resizeCbs.slice().forEach((c) => c()),
    flushFrame,
    hasFrame: () => pendingFrame !== null,
    listenerCounts: () => ({ writes: writeCbs.length, resizes: resizeCbs.length }),
  };
}

describe("attachSettleRepaint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does NOT repaint on a write while disarmed", () => {
    const h = makeHarness();
    attachSettleRepaint(h.term, () => false, h.deps);
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("repaints on a write once armed (the redraw heal)", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("coalesces a write burst into a single frame refresh", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    h.emitWrite();
    h.emitWrite();
    h.emitWrite();
    expect(h.hasFrame()).toBe(true);
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("stays armed waiting for a LATE first write up to the hard cap", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    // No write yet — the quiet timer must NOT have started, so well past the
    // quiet gap the window is still open for the (slow mobile) first redraw.
    vi.advanceTimersByTime(SETTLE_QUIET_MS + 500);
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("disarms SETTLE_QUIET_MS after the last write", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SETTLE_QUIET_MS); // quiet → disarm
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1); // no repaint after disarm
  });

  it("each write resets the quiet timer (window stays open during a stream)", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    h.emitWrite();
    h.flushFrame();
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 50); // not yet quiet
    h.emitWrite(); // resets quiet
    h.flushFrame();
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 50); // still within the reset gap
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it("disarms at the hard cap even on a continuous stream", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    vi.advanceTimersByTime(SETTLE_MAX_MS); // hard cap fires → disarm
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("disarm (hard cap) cancels a queued frame — no stray refresh after the window closes", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    s.arm();
    h.emitWrite(); // schedules a frame but DON'T flush it yet
    expect(h.hasFrame()).toBe(true);
    vi.advanceTimersByTime(SETTLE_MAX_MS); // hard cap fires disarm → cancels frame
    expect(h.hasFrame()).toBe(false);
    h.flushFrame(); // no-op now
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("arms internally on term.onResize", () => {
    const h = makeHarness();
    attachSettleRepaint(h.term, () => false, h.deps);
    h.emitResize(); // self-arm
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("never repaints when isDisposed() is true", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => true, h.deps);
    s.arm();
    h.emitWrite();
    h.flushFrame();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("dispose() removes both listeners and stops repainting", () => {
    const h = makeHarness();
    const s = attachSettleRepaint(h.term, () => false, h.deps);
    expect(h.listenerCounts()).toEqual({ writes: 1, resizes: 1 });
    s.arm();
    s.dispose();
    expect(h.listenerCounts()).toEqual({ writes: 0, resizes: 0 });
    h.emitWrite();
    h.emitResize();
    h.flushFrame();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
