// @covers FR-01.30
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTriageViewState } from "./useTriageViewState";
import { DEFAULT_FILTER_STATE, DEFAULT_SORT_STATE } from "../lib/triageFilterSort";
import { TRIAGE_VIEW_STORAGE_KEY } from "../lib/triageViewStorage";

afterEach(() => window.localStorage.clear());

describe("useTriageViewState", () => {
  it("starts from the defaults when nothing is saved", () => {
    const { result } = renderHook(() => useTriageViewState());
    expect(result.current.filters).toEqual(DEFAULT_FILTER_STATE);
    expect(result.current.sort).toEqual(DEFAULT_SORT_STATE);
    expect(result.current.groupBy).toBe("project");
    expect(result.current.collapsed.size).toBe(0);
    expect(window.localStorage.getItem(TRIAGE_VIEW_STORAGE_KEY)).toBeNull();
  });

  it("ticks and unticks a filter value (empty set = all)", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.toggleFilter("severities", "high"));
    expect(result.current.filters.severities.has("high")).toBe(true);
    act(() => result.current.toggleFilter("severities", "high"));
    expect(result.current.filters.severities.size).toBe(0);
  });

  it("remembers the view across a remount (the reload case)", () => {
    const first = renderHook(() => useTriageViewState());
    act(() => {
      first.result.current.toggleFilter("priorities", "P1");
      first.result.current.setPrimarySort({ key: "name", direction: "desc" });
      first.result.current.setGroupBy("severity");
    });
    act(() => first.result.current.toggleCollapsed("severity:low"));
    first.unmount();

    const second = renderHook(() => useTriageViewState());
    expect(second.result.current.filters.priorities.has("P1")).toBe(true);
    expect(second.result.current.sort.primary).toEqual({ key: "name", direction: "desc" });
    expect(second.result.current.groupBy).toBe("severity");
    expect(second.result.current.collapsed.has("severity:low")).toBe(true);
  });

  it("never overwrites a saved view with defaults on mount", () => {
    window.localStorage.setItem(
      TRIAGE_VIEW_STORAGE_KEY,
      JSON.stringify({ v: 1, groupBy: "source" }),
    );
    const { result } = renderHook(() => useTriageViewState());
    expect(result.current.groupBy).toBe("source");
    expect(JSON.parse(window.localStorage.getItem(TRIAGE_VIEW_STORAGE_KEY) as string).groupBy).toBe("source");
  });

  it("changing the grouping resets collapsed groups", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => result.current.toggleCollapsed("project:p1"));
    expect(result.current.collapsed.has("project:p1")).toBe(true);
    act(() => result.current.setGroupBy("severity"));
    expect(result.current.collapsed.size).toBe(0);
  });

  it("clearFilters resets filters (incl. Parked) but keeps sort and grouping", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => {
      result.current.toggleFilter("domains", "Quality");
      result.current.setShowParked(true);
      result.current.setGroupBy("priority");
      result.current.setSecondarySort({ key: "name", direction: "asc" });
    });
    act(() => result.current.clearFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTER_STATE);
    expect(result.current.groupBy).toBe("priority");
    expect(result.current.sort.secondary).toEqual({ key: "name", direction: "asc" });
  });

  it("resetView restores every default", () => {
    const { result } = renderHook(() => useTriageViewState());
    act(() => {
      result.current.toggleFilter("sources", "manual");
      result.current.setGroupBy("none");
    });
    act(() => result.current.resetView());
    expect(result.current.filters).toEqual(DEFAULT_FILTER_STATE);
    expect(result.current.groupBy).toBe("project");
  });
});
