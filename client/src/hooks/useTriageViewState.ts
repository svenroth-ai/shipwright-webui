/*
 * useTriageViewState.ts — owns the Triage page's view: filters, sort,
 * grouping and collapsed groups.
 *
 * iterate-2026-11-08-triage-page-redesign: the view is now REMEMBERED
 * (localStorage, versioned + validated in lib/triageViewStorage.ts). State
 * starts from a lazy read — never an effect — and only writes after a
 * change, so a first render can never overwrite the saved view with
 * defaults. Still purely a view concern: no store write, no network.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_FILTER_STATE,
  type SortLevel,
  type TriageFilterState,
  type TriageSortState,
} from "../lib/triageFilterSort";
import type { GroupBy } from "../lib/triageGrouping";
import {
  defaultView,
  loadView,
  saveView,
  type TriageViewSnapshot,
} from "../lib/triageViewStorage";

export type FilterGroup = "severities" | "sources" | "priorities" | "domains" | "complexities";

export interface TriageViewState {
  filters: TriageFilterState;
  sort: TriageSortState;
  groupBy: GroupBy;
  /** Collapsed group keys for the CURRENT grouping. */
  collapsed: ReadonlySet<string>;
  toggleFilter: (group: FilterGroup, value: string) => void;
  setShowParked: (value: boolean) => void;
  /** Resets the filters (not sort/grouping); Parked goes back to hidden. */
  clearFilters: () => void;
  setPrimarySort: (level: SortLevel) => void;
  setSecondarySort: (level: SortLevel) => void;
  setGroupBy: (value: GroupBy) => void;
  toggleCollapsed: (key: string) => void;
  /** Back to the defaults for everything. */
  resetView: () => void;
}

function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useTriageViewState(): TriageViewState {
  const [view, setView] = useState<TriageViewSnapshot>(loadView);

  // Persist after every change, but never before the first user change —
  // the initial state IS what was just read, so writing it back is a no-op
  // we skip to keep a blocked/failing storage from being hit on mount.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveView(view);
  }, [view]);

  const toggleFilter = useCallback((group: FilterGroup, value: string) => {
    setView((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        [group]: toggleInSet(prev.filters[group] as ReadonlySet<string>, value),
      },
    }));
  }, []);

  const setShowParked = useCallback((value: boolean) => {
    setView((prev) => ({ ...prev, filters: { ...prev.filters, showParked: value } }));
  }, []);

  const clearFilters = useCallback(() => {
    setView((prev) => ({ ...prev, filters: DEFAULT_FILTER_STATE }));
  }, []);

  const setPrimarySort = useCallback((level: SortLevel) => {
    setView((prev) => ({ ...prev, sort: { ...prev.sort, primary: level } }));
  }, []);

  const setSecondarySort = useCallback((level: SortLevel) => {
    setView((prev) => ({ ...prev, sort: { ...prev.sort, secondary: level } }));
  }, []);

  const setGroupBy = useCallback((value: GroupBy) => {
    setView((prev) =>
      prev.groupBy === value
        ? prev
        : { ...prev, groupBy: value, collapsed: { groupBy: value, keys: [] } },
    );
  }, []);

  const toggleCollapsed = useCallback((key: string) => {
    setView((prev) => ({
      ...prev,
      collapsed: {
        groupBy: prev.groupBy,
        keys: [...toggleInSet(new Set(prev.collapsed.keys), key)],
      },
    }));
  }, []);

  const resetView = useCallback(() => setView(defaultView()), []);

  const collapsed = useMemo(() => new Set(view.collapsed.keys), [view.collapsed]);

  return useMemo(
    () => ({
      filters: view.filters,
      sort: view.sort,
      groupBy: view.groupBy,
      collapsed,
      toggleFilter,
      setShowParked,
      clearFilters,
      setPrimarySort,
      setSecondarySort,
      setGroupBy,
      toggleCollapsed,
      resetView,
    }),
    [
      view.filters,
      view.sort,
      view.groupBy,
      collapsed,
      toggleFilter,
      setShowParked,
      clearFilters,
      setPrimarySort,
      setSecondarySort,
      setGroupBy,
      toggleCollapsed,
      resetView,
    ],
  );
}
