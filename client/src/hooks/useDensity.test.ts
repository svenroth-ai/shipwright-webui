/*
 * useDensity — AC5: density persists and is shared across surfaces (one cell).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DENSITY_STORAGE_KEY, useDensity } from "./useDensity";

beforeEach(() => {
  localStorage.clear();
  // Reset the module store to the default via the public API.
  const { result } = renderHook(() => useDensity());
  act(() => result.current.setDensity("comfortable"));
});
afterEach(() => localStorage.clear());

describe("useDensity", () => {
  it("defaults to comfortable", () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current.density).toBe("comfortable");
  });

  it("persists a set value to localStorage", () => {
    const { result } = renderHook(() => useDensity());
    act(() => result.current.setDensity("compact"));
    expect(result.current.density).toBe("compact");
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
  });

  it("toggles between comfortable and compact", () => {
    const { result } = renderHook(() => useDensity());
    act(() => result.current.toggleDensity());
    expect(result.current.density).toBe("compact");
    act(() => result.current.toggleDensity());
    expect(result.current.density).toBe("comfortable");
  });

  it("shares ONE cell across two hook instances (no drift)", () => {
    const a = renderHook(() => useDensity());
    const b = renderHook(() => useDensity());
    act(() => a.result.current.setDensity("compact"));
    expect(b.result.current.density).toBe("compact");
  });
});
