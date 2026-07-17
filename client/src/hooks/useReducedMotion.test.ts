/*
 * useReducedMotion — the reduced-motion signal (A20, FR-01.64).
 *
 * RED-first (AC6): fails until hooks/useReducedMotion.ts exists. Covers BOTH
 * media states AND the load-bearing fallback: when matchMedia is unavailable
 * (SSR / jsdom / an old embedder) the hook FAILS TOWARD reduce — never toward
 * hidden content. A JS-driven moment reading `true` renders its final value.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useReducedMotion, REDUCED_MOTION_QUERY } from "./useReducedMotion";

type Listener = (e: MediaQueryListEvent) => void;

function mockMatchMedia(initialMatches: boolean) {
  let listener: Listener | null = null;
  const mql = {
    matches: initialMatches,
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: vi.fn((_evt: string, l: Listener) => {
      listener = l;
    }),
    removeEventListener: vi.fn(() => {
      listener = null;
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    mql,
    fire(matches: boolean) {
      mql.matches = matches;
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // @covers FR-01.64
  it("queries the prefers-reduced-motion: reduce media feature", () => {
    mockMatchMedia(false);
    renderHook(() => useReducedMotion());
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  // @covers FR-01.64
  it("returns true when the user asked to reduce motion (Sven's everyday state)", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  // @covers FR-01.64
  it("returns false under no-preference (motion is welcome)", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  // @covers FR-01.64
  it("reacts to a live change (no-preference -> reduce -> no-preference)", () => {
    const h = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => h.fire(true));
    expect(result.current).toBe(true);
    act(() => h.fire(false));
    expect(result.current).toBe(false);
  });

  // @covers FR-01.64
  it("subscribes via addEventListener and cleans up on unmount", () => {
    const h = mockMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(h.mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(h.mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  // @covers FR-01.64
  it("FAILS TOWARD reduce (true) when matchMedia is unavailable — never toward hidden content", () => {
    const original = window.matchMedia;
    // @ts-expect-error — simulate an environment without matchMedia (SSR / jsdom)
    delete window.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    window.matchMedia = original;
  });
});
