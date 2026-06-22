/*
 * activation-repaint.test — DATA-INDEPENDENT trailing repaints (iterate-2026-
 * 06-22). Fake term exposes a refresh spy; setTimeout/clearTimeout are injected
 * as a manual queue so the staggered passes + cancellation are deterministic
 * (mirrors repaint-on-settle.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import {
  createActivationRepaint,
  ACTIVATION_REPAINT_DELAYS_MS,
} from "./activation-repaint";

function makeHarness() {
  const refresh = vi.fn();
  let term: Terminal | null = { rows: 24, refresh } as unknown as Terminal;
  let disposed = false;

  let nextId = 1;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  const setTimer = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = nextId++;
    pending.set(id, { cb, ms });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimer = (h: ReturnType<typeof setTimeout>): void => {
    pending.delete(h as unknown as number);
  };
  const fireAll = (): void => {
    const due = [...pending.values()].sort((a, b) => a.ms - b.ms);
    pending.clear();
    for (const { cb } of due) cb();
  };

  const handle = createActivationRepaint(
    () => term,
    () => disposed,
    { setTimer, clearTimer },
  );

  return {
    handle,
    refresh,
    fireAll,
    pendingCount: () => pending.size,
    setDisposed: (v: boolean) => {
      disposed = v;
    },
    setTerm: (t: Terminal | null) => {
      term = t;
    },
  };
}

describe("createActivationRepaint", () => {
  it("queues one timer per configured delay on schedule()", () => {
    const h = makeHarness();
    expect(h.pendingCount()).toBe(0);
    h.handle.schedule();
    expect(h.pendingCount()).toBe(ACTIVATION_REPAINT_DELAYS_MS.length);
  });

  it("repaints the full viewport once per delay when the timers fire", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.fireAll();
    expect(h.refresh).toHaveBeenCalledTimes(ACTIVATION_REPAINT_DELAYS_MS.length);
    expect(h.refresh).toHaveBeenCalledWith(0, 23);
  });

  it("does nothing before schedule() is called", () => {
    const h = makeHarness();
    h.fireAll();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("re-scheduling cancels the prior in-flight set (no stacking)", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.handle.schedule();
    expect(h.pendingCount()).toBe(ACTIVATION_REPAINT_DELAYS_MS.length);
    h.fireAll();
    expect(h.refresh).toHaveBeenCalledTimes(ACTIVATION_REPAINT_DELAYS_MS.length);
  });

  it("clear() cancels all pending passes", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.handle.clear();
    expect(h.pendingCount()).toBe(0);
    h.fireAll();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("schedule() queues nothing when already disposed", () => {
    const h = makeHarness();
    h.setDisposed(true);
    h.handle.schedule();
    expect(h.pendingCount()).toBe(0);
    h.fireAll();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a pass that fires AFTER disposal does not repaint", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.setDisposed(true); // disposed between schedule and fire
    h.fireAll();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a pass that fires after the term is gone does not throw or repaint", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.setTerm(null); // term ref nulled (mid-dispose) before the timers fire
    expect(() => h.fireAll()).not.toThrow();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
