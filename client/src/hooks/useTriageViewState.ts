/*
 * useTriageViewState.ts — owns the Triage tab's filter/sort UI state.
 *
 * Purely a VIEW concern (iterate-2026-08-08-triage-filters-sort-parked):
 * in-memory only, no store write, no persistence across reloads/
 * navigation. Extracted out of TriagePage.tsx so that file's growth
 * stays in one small, focused module rather than several inline
 * `useState` calls padding the page component (bloat-ceiling risk
 * flagged at internal plan review).
 */

import { useCallback, useMemo, useState } from "react";

import {
  DEFAULT_FILTER_STATE,
  DEFAULT_SORT_STATE,
  type ComplexityFilterValue,
  type SortLevel,
  type TriageFilterState,
  type TriageSortState,
} from "../lib/triageFilterSort";
import type { TriagePriority } from "../lib/triageApi";

export interface TriageViewState {
  filters: TriageFilterState;
  sort: TriageSortState;
  togglePriority: (value: TriagePriority) => void;
  toggleDomain: (value: string) => void;
  toggleComplexity: (value: ComplexityFilterValue) => void;
  setShowParked: (value: boolean) => void;
  /** Resets `filters` (not `sort`) to DEFAULT_FILTER_STATE — the affordance
   * AC5's "clear filters to see them" copy promises (code-reviewer finding:
   * the copy existed with no control to back it). */
  clearFilters: () => void;
  setPrimarySort: (level: SortLevel) => void;
  setSecondarySort: (level: SortLevel) => void;
}

function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useTriageViewState(): TriageViewState {
  const [filters, setFilters] = useState<TriageFilterState>(DEFAULT_FILTER_STATE);
  const [sort, setSort] = useState<TriageSortState>(DEFAULT_SORT_STATE);

  const togglePriority = useCallback((value: TriagePriority) => {
    setFilters((prev) => ({
      ...prev,
      excludedPriorities: toggleInSet(prev.excludedPriorities, value),
    }));
  }, []);

  const toggleDomain = useCallback((value: string) => {
    setFilters((prev) => ({
      ...prev,
      excludedDomains: toggleInSet(prev.excludedDomains, value),
    }));
  }, []);

  const toggleComplexity = useCallback((value: ComplexityFilterValue) => {
    setFilters((prev) => ({
      ...prev,
      excludedComplexities: toggleInSet(prev.excludedComplexities, value),
    }));
  }, []);

  const setShowParked = useCallback((value: boolean) => {
    setFilters((prev) => ({ ...prev, showParked: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTER_STATE);
  }, []);

  const setPrimarySort = useCallback((level: SortLevel) => {
    setSort((prev) => ({ ...prev, primary: level }));
  }, []);

  const setSecondarySort = useCallback((level: SortLevel) => {
    setSort((prev) => ({ ...prev, secondary: level }));
  }, []);

  return useMemo(
    () => ({
      filters,
      sort,
      togglePriority,
      toggleDomain,
      toggleComplexity,
      setShowParked,
      clearFilters,
      setPrimarySort,
      setSecondarySort,
    }),
    [
      filters,
      sort,
      togglePriority,
      toggleDomain,
      toggleComplexity,
      setShowParked,
      clearFilters,
      setPrimarySort,
      setSecondarySort,
    ],
  );
}
