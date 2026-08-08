import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTriageViewState } from "./useTriageViewState";
import { DEFAULT_FILTER_STATE, DEFAULT_SORT_STATE } from "../lib/triageFilterSort";

describe("useTriageViewState", () => {
  it("defaults to the empty-filter, default-sort state (view-only, no persistence)", () => {
    const { result } = renderHook(() => useTriageViewState());
    expect(result.current.filters).toEqual(DEFAULT_FILTER_STATE);
    expect(result.current.sort).toEqual(DEFAULT_SORT_STATE);
  });

  it("toggles a priority into and back out of the excluded set (AC1 — click excludes, click again restores)", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.togglePriority("P3"));
    expect(result.current.filters.excludedPriorities.has("P3")).toBe(true);
    act(() => result.current.togglePriority("P3"));
    expect(result.current.filters.excludedPriorities.has("P3")).toBe(false);
  });

  it("toggles a domain independently of priority", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.toggleDomain("engineering"));
    expect(result.current.filters.excludedDomains.has("engineering")).toBe(true);
    expect(result.current.filters.excludedPriorities.size).toBe(0);
  });

  it("AC3: toggles a complexity value, including 'unset', into the excluded set", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.toggleComplexity("unset"));
    expect(result.current.filters.excludedComplexities.has("unset")).toBe(true);
  });

  it("Parked is its own boolean, not a value inside any other filter set", () => {
    const { result } = renderHook(() => useTriageViewState());
    expect(result.current.filters.showParked).toBe(false);
    act(() => result.current.setShowParked(true));
    expect(result.current.filters.showParked).toBe(true);
    expect(result.current.filters.excludedPriorities.size).toBe(0);
  });

  it("clearFilters resets filters to DEFAULT_FILTER_STATE without touching sort (the affordance behind AC5's 'clear filters' copy)", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.togglePriority("P3"));
    act(() => result.current.toggleDomain("engineering"));
    act(() => result.current.setShowParked(true));
    act(() => result.current.setPrimarySort({ key: "name", direction: "asc" }));
    act(() => result.current.clearFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTER_STATE);
    expect(result.current.sort.primary).toEqual({ key: "name", direction: "asc" });
  });

  it("sets primary and secondary sort levels independently", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.setPrimarySort({ key: "name", direction: "asc" }));
    expect(result.current.sort.primary).toEqual({ key: "name", direction: "asc" });
    expect(result.current.sort.secondary).toEqual(DEFAULT_SORT_STATE.secondary);
    act(() => result.current.setSecondarySort({ key: "domain", direction: "desc" }));
    expect(result.current.sort.secondary).toEqual({ key: "domain", direction: "desc" });
    expect(result.current.sort.primary).toEqual({ key: "name", direction: "asc" });
  });
});
