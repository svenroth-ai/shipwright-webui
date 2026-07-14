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

function makeHarness(opts: { withHeal?: boolean } = {}) {
  const refresh = vi.fn();
  const healAtlas = vi.fn();
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
  /** Fire only the earliest pending pass — proves the heal rides the LAST one. */
  const fireFirstOnly = (): void => {
    const due = [...pending.entries()].sort((a, b) => a[1].ms - b[1].ms);
    const first = due[0];
    if (!first) return;
    pending.delete(first[0]);
    first[1].cb();
  };

  const handle = createActivationRepaint(
    () => term,
    () => disposed,
    {
      setTimer,
      clearTimer,
      // Default arm = WebGL present (a heal is available). `withHeal: false`
      // models the DOM-renderer arm, where no atlas exists to clear.
      getHealAtlas: opts.withHeal === false ? () => null : () => healAtlas,
    },
  );

  return {
    handle,
    refresh,
    healAtlas,
    fireAll,
    fireFirstOnly,
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

  // --- WebGL glyph-atlas heal (iterate-2026-07-14, FR-01.28) ---
  // `term.refresh` CANNOT heal a stale glyph atlas — it routes to
  // WebglRenderer._updateModel, which skips cells that "look unchanged". Only
  // `clearTextureAtlas()` clears the texture + render model. It rides EVERY
  // trailing pass: a single fixed deadline is the fragility #167 already learned
  // to avoid, and an early clear is redundant rather than harmful (the clear
  // invalidates every atlas texture, so model + atlas stay consistent — see the
  // ATLAS HEAL note). It is never synchronous on schedule(), though.

  it("invokes the atlas heal on EVERY pass (a second shot if the compositor is late)", () => {
    const h = makeHarness();
    h.handle.schedule();
    expect(h.healAtlas).not.toHaveBeenCalled(); // not synchronous on schedule()
    h.fireAll();
    expect(h.healAtlas).toHaveBeenCalledTimes(ACTIVATION_REPAINT_DELAYS_MS.length);
  });

  it("heals on the FIRST pass already (does not wait for the trailing one)", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.fireFirstOnly();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.healAtlas).toHaveBeenCalledTimes(1);
  });

  it("a burst of schedule() calls yields one heal PER PASS, not per event", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.handle.schedule();
    h.handle.schedule();
    h.fireAll();
    // Each schedule() cancels the prior set, so three events cost one set —
    // bounded by the pass count, NOT 3 × the pass count.
    expect(h.healAtlas).toHaveBeenCalledTimes(ACTIVATION_REPAINT_DELAYS_MS.length);
  });

  it("no heal in the DOM-renderer arm (no WebGL addon → nothing to clear)", () => {
    const h = makeHarness({ withHeal: false });
    h.handle.schedule();
    expect(() => h.fireAll()).not.toThrow();
    // The refresh passes still run — they are the DOM arm's only repaint.
    expect(h.refresh).toHaveBeenCalledTimes(ACTIVATION_REPAINT_DELAYS_MS.length);
    expect(h.healAtlas).not.toHaveBeenCalled();
  });

  it("a pass firing after disposal does not heal", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.setDisposed(true);
    h.fireAll();
    expect(h.healAtlas).not.toHaveBeenCalled();
  });

  it("clear() cancels the pending heal", () => {
    const h = makeHarness();
    h.handle.schedule();
    h.handle.clear();
    h.fireAll();
    expect(h.healAtlas).not.toHaveBeenCalled();
  });

  it("a heal that throws does not break the pass (mid-dispose term)", () => {
    const h = makeHarness();
    h.healAtlas.mockImplementation(() => {
      throw new Error("term mid-dispose");
    });
    h.handle.schedule();
    expect(() => h.fireAll()).not.toThrow();
  });
});
