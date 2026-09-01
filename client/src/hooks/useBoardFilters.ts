/*
 * useBoardFilters — the board's status + lead-tag filter state, and the
 * derived filtered task list (FR-04.11, V3). Extracted out of
 * TaskBoardPage.tsx (iterate-2026-09-01-lead-board-surface) — the status
 * filter was already inline there; folding the lead-tag filter in alongside
 * it (rather than as a sibling hook) keeps TaskBoardPage.tsx under its bloat
 * baseline instead of raising it (code review finding: the two hooks were
 * pulling in opposite directions on the same file's line count).
 *
 * Both filters are multi-select `Set`s, empty = "All" (no filter),
 * OR-within-group. Status and lead-tag are independent axes, ANDed together
 * in `filteredTasks`. Each filter's own per-option counts are computed on
 * `projectFiltered` alone — independent of the OTHER filter and of itself —
 * so counts stay stable as the user toggles either one (GitHub/Linear
 * filter-bar convention, matches the pre-existing `statusCounts` behavior).
 * The Bot menu's "All" row total is `projectFiltered.length` for the same
 * reason: lead-tag buckets can overlap (a task can carry more than one
 * prefix) and are not exhaustive (an ordinary task carries none), so a sum
 * of the three would double-count and under-represent (code review finding)
 * — the total is reported directly, on the same basis as the per-prefix
 * counts, not derived from them.
 */
import { useCallback, useMemo, useState } from "react";

import type { ExternalTask, ExternalTaskState } from "../lib/externalApi";
import { LEAD_TAG_PREFIXES, hasPrefix, matchesAnyLeadPrefix, type LeadTagPrefix } from "../lib/leadTags";

export function useBoardFilters(projectFiltered: ExternalTask[]) {
  const [statusFilter, setStatusFilter] = useState<Set<ExternalTaskState>>(() => new Set());
  const toggleStatus = useCallback((s: ExternalTaskState) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);
  const clearStatusFilter = useCallback(() => {
    setStatusFilter(new Set());
  }, []);

  const [leadTagFilter, setLeadTagFilter] = useState<Set<LeadTagPrefix>>(() => new Set());
  const toggleLeadTag = useCallback((prefix: LeadTagPrefix) => {
    setLeadTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  }, []);
  const clearLeadTagFilter = useCallback(() => {
    setLeadTagFilter(new Set());
  }, []);

  const clearAllFilters = useCallback(() => {
    clearStatusFilter();
    clearLeadTagFilter();
  }, [clearStatusFilter, clearLeadTagFilter]);

  const filteredTasks = useMemo<ExternalTask[]>(() => {
    let out = projectFiltered;
    if (statusFilter.size > 0) out = out.filter((t) => statusFilter.has(t.state));
    if (leadTagFilter.size > 0) {
      out = out.filter((t) => matchesAnyLeadPrefix(t.tags, leadTagFilter));
    }
    return out;
  }, [projectFiltered, statusFilter, leadTagFilter]);

  const statusCounts = useMemo<Record<ExternalTaskState, number>>(() => {
    const seed: Record<ExternalTaskState, number> = {
      draft: 0,
      awaiting_external_start: 0,
      active: 0,
      idle: 0,
      done: 0,
      launch_failed: 0,
      jsonl_missing: 0,
    };
    for (const t of projectFiltered) {
      if (t.state in seed) seed[t.state] += 1;
    }
    return seed;
  }, [projectFiltered]);

  const leadTagCounts = useMemo<Record<LeadTagPrefix, number>>(() => {
    const seed: Record<LeadTagPrefix, number> = {
      [LEAD_TAG_PREFIXES[0]]: 0,
      [LEAD_TAG_PREFIXES[1]]: 0,
      [LEAD_TAG_PREFIXES[2]]: 0,
    };
    for (const t of projectFiltered) {
      for (const prefix of LEAD_TAG_PREFIXES) {
        if (hasPrefix(t.tags, prefix)) seed[prefix] += 1;
      }
    }
    return seed;
  }, [projectFiltered]);

  // Any filter active + zero results, but the project genuinely has tasks —
  // distinct from the A07 "zero tasks at all" empty state. Adding a third
  // filter axis plus a one-click BellDot toggle makes this trivially easy to
  // hit by accident (internal plan review), so both view modes get a "clear
  // filters" affordance instead of three silently-empty columns or an empty
  // table.
  const noFilterMatches =
    (statusFilter.size > 0 || leadTagFilter.size > 0) &&
    filteredTasks.length === 0 &&
    projectFiltered.length > 0;

  return {
    statusFilter,
    toggleStatus,
    clearStatusFilter,
    statusCounts,
    leadTagFilter,
    toggleLeadTag,
    clearLeadTagFilter,
    leadTagCounts,
    leadTagTotal: projectFiltered.length,
    filteredTasks,
    noFilterMatches,
    clearAllFilters,
  };
}
