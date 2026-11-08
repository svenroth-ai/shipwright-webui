/*
 * triageViewStorage.ts — versioned, validated persistence of the Triage
 * page's view (filters, sort, grouping, collapsed groups) in localStorage
 * (iterate-2026-11-08-triage-page-redesign).
 *
 * Rules: every storage access is in try/catch (private windows, blocked
 * site data, quota); a read NEVER throws — anything unreadable, outdated or
 * of the wrong shape falls back to the defaults, per field where possible;
 * unknown values inside an otherwise valid payload are dropped (never
 * interpreted as "show nothing"). Sets are stored as arrays.
 */

import {
  COMPLEXITY_FILTER_VALUES,
  DEFAULT_FILTER_STATE,
  DEFAULT_SORT_STATE,
  PRIORITY_VALUES,
  SEVERITY_VALUES,
  SORT_KEYS,
  type ComplexityFilterValue,
  type SortLevel,
  type TriageFilterState,
  type TriageSortState,
} from "./triageFilterSort";
import { GROUP_BY_VALUES, type GroupBy } from "./triageGrouping";
import type { TriagePriority, TriageSeverity } from "./triageApi";

export const TRIAGE_VIEW_STORAGE_KEY = "shipwright:triage-view:v1";
const VERSION = 1;
const MAX_STRINGS = 50;
const MAX_STRING_LEN = 80;

/** Collapsed group keys belong to ONE grouping; they reset when it changes. */
export interface CollapsedState {
  groupBy: GroupBy;
  keys: string[];
}

export interface TriageViewSnapshot {
  filters: TriageFilterState;
  sort: TriageSortState;
  groupBy: GroupBy;
  collapsed: CollapsedState;
}

export const DEFAULT_GROUP_BY: GroupBy = "project";

export function defaultView(): TriageViewSnapshot {
  return {
    filters: DEFAULT_FILTER_STATE,
    sort: DEFAULT_SORT_STATE,
    groupBy: DEFAULT_GROUP_BY,
    collapsed: { groupBy: DEFAULT_GROUP_BY, keys: [] },
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function pickAllowed<T extends string>(raw: unknown, allowed: readonly T[]): Set<T> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((v): v is T => (allowed as readonly unknown[]).includes(v)));
}

function pickStrings(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw
      .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_STRING_LEN)
      .slice(0, MAX_STRINGS),
  );
}

function parseLevel(raw: unknown, fallback: SortLevel): SortLevel {
  if (!isRecord(raw)) return fallback;
  const key = (SORT_KEYS as readonly unknown[]).includes(raw.key)
    ? (raw.key as SortLevel["key"])
    : fallback.key;
  const direction = raw.direction === "asc" || raw.direction === "desc" ? raw.direction : fallback.direction;
  return { key, direction };
}

/** Parses a stored string. Never throws; returns defaults for anything bad. */
export function parseView(raw: string | null): TriageViewSnapshot {
  const fallback = defaultView();
  if (!raw) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isRecord(data) || data.v !== VERSION) return fallback;

  const f = isRecord(data.filters) ? data.filters : {};
  const filters: TriageFilterState = {
    severities: pickAllowed<TriageSeverity>(f.severities, SEVERITY_VALUES),
    sources: pickStrings(f.sources),
    priorities: pickAllowed<TriagePriority>(f.priorities, PRIORITY_VALUES),
    domains: pickStrings(f.domains),
    complexities: pickAllowed<ComplexityFilterValue>(f.complexities, COMPLEXITY_FILTER_VALUES),
    showParked: f.showParked === true,
  };

  const s = isRecord(data.sort) ? data.sort : {};
  const sort: TriageSortState = {
    primary: parseLevel(s.primary, DEFAULT_SORT_STATE.primary),
    secondary: parseLevel(s.secondary, DEFAULT_SORT_STATE.secondary),
  };

  const groupBy: GroupBy = (GROUP_BY_VALUES as readonly unknown[]).includes(data.groupBy)
    ? (data.groupBy as GroupBy)
    : DEFAULT_GROUP_BY;

  const c = isRecord(data.collapsed) ? data.collapsed : {};
  const collapsed: CollapsedState =
    c.groupBy === groupBy
      ? { groupBy, keys: [...pickStrings(c.keys)] }
      : { groupBy, keys: [] };

  return { filters, sort, groupBy, collapsed };
}

export function serializeView(view: TriageViewSnapshot): string {
  const f = view.filters;
  return JSON.stringify({
    v: VERSION,
    filters: {
      severities: [...f.severities],
      sources: [...f.sources],
      priorities: [...f.priorities],
      domains: [...f.domains],
      complexities: [...f.complexities],
      showParked: f.showParked,
    },
    sort: view.sort,
    groupBy: view.groupBy,
    collapsed: view.collapsed,
  });
}

export function loadView(): TriageViewSnapshot {
  try {
    return parseView(window.localStorage.getItem(TRIAGE_VIEW_STORAGE_KEY));
  } catch {
    return defaultView();
  }
}

export function saveView(view: TriageViewSnapshot): void {
  try {
    window.localStorage.setItem(TRIAGE_VIEW_STORAGE_KEY, serializeView(view));
  } catch {
    /* storage unavailable — the view simply is not remembered */
  }
}
