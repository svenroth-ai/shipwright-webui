/*
 * triageBoardModel.ts — the whole Triage page pipeline as ONE pure function
 * (iterate-2026-11-08-triage-page-redesign): scope → filter (with the two
 * park exceptions) → search → tile → sort → group.
 *
 * "Showing N of M": N = open entries left after filters, search and tile;
 * M = every open entry in the current project scope. Parked entries are
 * counted separately (their own section, own count) and never in M.
 */

import { sortDeferred } from "./sortDeferred";
import { computeFacets, type Facets } from "./triageFacets";
import {
  SEVERITY_RANK,
  selectVisibleDeferredItems,
  selectVisibleOpenItems,
  sortEntries,
  type TriageEntry,
  type TriageFilterState,
  type TriageSortState,
} from "./triageFilterSort";
import { groupEntries, type GroupBy, type GroupProject, type TriageGroup } from "./triageGrouping";
import { sourceLabel } from "./triageHelpText";

export type TriageTileFilter = "attn" | null;

export interface BoardInput {
  /** Entries already limited to the chosen project scope. */
  entries: readonly TriageEntry[];
  filters: TriageFilterState;
  sort: TriageSortState;
  groupBy: GroupBy;
  search: string;
  tile: TriageTileFilter;
  projects: readonly GroupProject[];
}

export interface BoardModel {
  openAll: TriageEntry[];
  parkedAll: TriageEntry[];
  /** Filtered + sorted open entries (what the list shows). */
  visibleOpen: TriageEntry[];
  groups: TriageGroup[];
  /** Open entries hidden by filters (a returned park never counts). */
  hiddenByFilters: number;
  visibleParked: TriageEntry[];
  /** Parked entries hidden by the Parked switch or the filters. */
  hiddenParked: number;
  facets: Facets;
  /** Critical + High among the open entries in scope. */
  attention: number;
}

function matchesSearch(e: TriageEntry, q: string): boolean {
  if (!q) return true;
  const hay = `${e.item.title}\n${e.item.detail}\n${e.item.id}`.toLowerCase();
  return hay.includes(q);
}

export function buildBoardModel(input: BoardInput): BoardModel {
  const openAll = input.entries.filter((e) => e.item.status === "triage");
  const parkedAll = input.entries.filter((e) => e.item.status === "snoozed");
  const q = input.search.trim().toLowerCase();

  const open = selectVisibleOpenItems(openAll, input.filters);
  const narrowed = open.visible.filter(
    (e) =>
      (e.item.revisitDue || matchesSearch(e, q)) &&
      (input.tile !== "attn" ||
        e.item.revisitDue ||
        e.item.severity === "critical" ||
        e.item.severity === "high"),
  );
  const visibleOpen = sortEntries(narrowed, input.sort);

  const parked = selectVisibleDeferredItems(parkedAll, input.filters);
  const byItem = new Map(parked.visible.map((e) => [e.item, e] as const));
  const visibleParked = sortDeferred(
    parked.visible.map((e) => e.item).filter((it) => matchesSearch(byItem.get(it) as TriageEntry, q)),
    SEVERITY_RANK,
  ).map((it) => byItem.get(it) as TriageEntry);

  return {
    openAll,
    parkedAll,
    visibleOpen,
    groups: groupEntries(visibleOpen, input.groupBy, input.projects, sourceLabel),
    hiddenByFilters: open.hiddenCount,
    visibleParked,
    hiddenParked: parked.hiddenCount,
    facets: computeFacets(openAll),
    attention: openAll.filter((e) => e.item.severity === "critical" || e.item.severity === "high").length,
  };
}
