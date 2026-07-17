/*
 * useCountUp — the JS-driven count-up primitive (A20, FR-01.64).
 *
 * RED-first (AC6): fails until hooks/useCountUp.ts exists. The load-bearing case
 * is the FINAL value under reduced motion: a count-up must never gate its number
 * behind the animation. Under reduced motion (or no matchMedia) the hook returns
 * the final value on the FIRST render — the number is there, it just doesn't
 * count. Under no-preference it interpolates 0 -> value across the frames.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useCountUp } from "./useCountUp";

type Listener = (e: MediaQueryListEvent) => void;

function mockMatchMedia(reduce: boolean) {
  const mql = {
    matches: reduce,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn((_e: string, _l: Listener) => {}),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
}

describe("useCountUp — the reduced-motion contract (AC6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the FINAL value immediately under reduced motion — no count-up, but the number is there", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useCountUp(98));
    expect(result.current).toBe(98);
  });

  it("renders the FINAL value when matchMedia is unavailable (fail toward final content)", () => {
    const original = window.matchMedia;
    // @ts-expect-error — simulate SSR / jsdom without matchMedia
    delete window.matchMedia;
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
    window.matchMedia = original;
  });

  it("respects a durationMs of 0 by snapping to the final value", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useCountUp(77, { durationMs: 0 }));
    expect(result.current).toBe(77);
  });

  it("renders a value that changes under reduced motion IMMEDIATELY (no stale partial)", () => {
    // A score that loads async (0 -> 91) under reduced motion must show 91 on the
    // very render it arrives, not a partial left over from any prior count.
    mockMatchMedia(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    expect(result.current).toBe(0);
    rerender({ v: 91 });
    expect(result.current).toBe(91);
  });
});

describe("useCountUp — the animated path (no-preference)", () => {
  const rafQueue: FrameRequestCallback[] = [];
  let now = 0;

  afterEach(() => {
    vi.restoreAllMocks();
    rafQueue.length = 0;
    now = 0;
  });

  function installControllableRaf() {
    now = 1000;
    vi.stubGlobal("performance", { now: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  }

  function flush(deltaMs: number) {
    now += deltaMs;
    const cbs = rafQueue.splice(0, rafQueue.length);
    act(() => {
      for (const cb of cbs) cb(now);
    });
  }

  it("starts below the final value and reaches it once the frames complete", () => {
    mockMatchMedia(false);
    installControllableRaf();
    const { result } = renderHook(() => useCountUp(100, { durationMs: 600 }));
    // first render (no-preference) starts at `from` (0), not the final value
    expect(result.current).toBe(0);
    flush(300); // half-way — strictly between 0 and 100
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);
    flush(400); // past the end → clamps to final
    expect(result.current).toBe(100);
  });
});
