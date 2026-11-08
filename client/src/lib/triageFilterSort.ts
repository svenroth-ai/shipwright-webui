/*
 * triageFilterSort.ts — pure, view-only filter/sort/group logic for the
 * Triage page. No store writes, no network calls — every function here is a
 * synchronous transform over already-fetched triage entries.
 *
 * iterate-2026-11-08-triage-page-redesign: the filter model is INCLUDE
 * (nothing ticked in a group = every value, ticked = only those), the same
 * rule as the Board's status filter. This reverses the exclude-set model of
 * iterate-2026-08-08-triage-filters-sort-parked on purpose (operator
 * decision B). The two named exceptions to "Parked defaults to hidden" stay
 * explicit, commented bypasses in `selectVisibleOpenItems` /
 * `selectVisibleDeferredItems` — only the attribute predicate changed.
 */

import type {
  TriageComplexityHint,
  TriageItem,
  TriagePriority,
  TriageSeverity,
} from "./triageApi";

export type ComplexityFilterValue = TriageComplexityHint | "unset";

export const COMPLEXITY_FILTER_VALUES: readonly ComplexityFilterValue[] = [
  "small",
  "medium",
  "large",
  "unset",
];

export const SEVERITY_VALUES: readonly TriageSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const PRIORITY_VALUES: readonly TriagePriority[] = ["P0", "P1", "P2", "P3"];

/** 0 = most severe. Shared by the deferred ordering and the severity sort. */
export const SEVERITY_RANK: Record<TriageSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * One list row: an item together with the project that owns it. Triage ids
 * can collide across projects, so every handler, key and selection in the
 * page is addressed by `projectId` + `item.id`, never `item.id` alone.
 */
export interface TriageEntry {
  projectId: string;
  item: TriageItem;
}

export function entryKey(e: TriageEntry): string {
  return `${e.projectId}:${e.item.id}`;
}

/**
 * `TriageItem` does not declare a complexity field (server canonical:
 * `server/src/types/triage.ts`; adding one would trip the schema-sync drift
 * guard). This intersection type is scoped to this module only.
 */
type TriageItemMaybeComplexity = TriageItem & {
  suggestedComplexity?: TriageComplexityHint;
};

/**
 * Reads + normalizes the forward-compat field at runtime: an unrecognized
 * value classifies as "unset" — visible, filterable, honest.
 */
export function getComplexity(item: TriageItem): ComplexityFilterValue {
  const raw = (item as TriageItemMaybeComplexity).suggestedComplexity;
  return (COMPLEXITY_FILTER_VALUES as readonly string[]).includes(raw ?? "unset")
    ? (raw ?? "unset")
    : "unset";
}

export interface TriageFilterState {
  /** Empty set = every severity. */
  severities: ReadonlySet<TriageSeverity>;
  /** Empty set = every source. */
  sources: ReadonlySet<string>;
  /** Empty set = every priority. */
  priorities: ReadonlySet<TriagePriority>;
  /** Empty set = every domain. */
  domains: ReadonlySet<string>;
  /** Empty set = every complexity (incl. "unset"). */
  complexities: ReadonlySet<ComplexityFilterValue>;
  /** Parked is its own switch (default hidden), not a value in a group. */
  showParked: boolean;
}

export const DEFAULT_FILTER_STATE: TriageFilterState = {
  severities: new Set(),
  sources: new Set(),
  priorities: new Set(),
  domains: new Set(),
  complexities: new Set(),
  showParked: false,
};

/** Number of attribute values currently ticked (drives the funnel dot). */
export function activeFilterCount(f: TriageFilterState): number {
  return (
    f.severities.size +
    f.sources.size +
    f.priorities.size +
    f.domains.size +
    f.complexities.size
  );
}

function allows<T>(set: ReadonlySet<T>, value: T): boolean {
  return set.size === 0 || set.has(value);
}

export function matchesAttributeFilters(
  item: TriageItem,
  filters: TriageFilterState,
): boolean {
  return (
    allows(filters.severities, item.severity) &&
    allows(filters.sources, item.source) &&
    allows(filters.priorities, item.suggestedPriority) &&
    allows(filters.domains, item.suggestedDomain) &&
    allows(filters.complexities, getComplexity(item))
  );
}

/**
 * "N" when nothing is filtered out, "N of M" (visible of total) when it is —
 * the one count-form convention for every heading whose visible count can
 * differ from its total.
 */
export function formatCount(visible: number, total: number): string {
  return visible === total ? `${total}` : `${visible} of ${total}`;
}

export interface VisibleSelection<T> {
  visible: T[];
  /** Always `input.length - visible.length` — never a second predicate pass. */
  hiddenCount: number;
}

/**
 * Open (`status === "triage"`) entries, filtered + the returned-park bypass.
 *
 * A due-parked item (`revisitDue === true`) has already been flipped to
 * `status: "triage"` upstream before this runs, but it can still miss the
 * ticked values. It must survive every active filter regardless and must NOT
 * be counted as hidden (it was shown, not hidden) — the `||` bypass below.
 */
export function selectVisibleOpenItems(
  entries: TriageEntry[],
  filters: TriageFilterState,
): VisibleSelection<TriageEntry> {
  const visible = entries.filter(
    (e) => e.item.revisitDue || matchesAttributeFilters(e.item, filters),
  );
  return { visible, hiddenCount: entries.length - visible.length };
}

/**
 * Deferred (`status === "snoozed"`) entries, filtered + the dateless-park
 * exception.
 *
 * A dateless park (`revisitAt === null`) never becomes due, so without a
 * standing exception the Parked-off default would hide it forever. It
 * survives that default while still respecting the attribute filters — the
 * AND below, not an unconditional bypass.
 */
export function selectVisibleDeferredItems(
  entries: TriageEntry[],
  filters: TriageFilterState,
): VisibleSelection<TriageEntry> {
  const visible = entries.filter((e) => {
    const passesParkedToggle = filters.showParked || e.item.revisitAt === null;
    return passesParkedToggle && matchesAttributeFilters(e.item, filters);
  });
  return { visible, hiddenCount: entries.length - visible.length };
}

export type SortKey = "severity" | "priority" | "modified" | "name";
export type SortDirection = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = ["severity", "priority", "modified", "name"];

export interface SortLevel {
  key: SortKey;
  direction: SortDirection;
}

export interface TriageSortState {
  primary: SortLevel;
  secondary: SortLevel;
}

/** Most severe first, then newest decision first. */
export const DEFAULT_SORT_STATE: TriageSortState = {
  primary: { key: "severity", direction: "desc" },
  secondary: { key: "modified", direction: "desc" },
};

/** Pinned so ordering never varies by runtime ICU locale. */
const LOCALE_COMPARE_OPTIONS: Intl.CollatorOptions = {
  sensitivity: "base",
  numeric: true,
};

/** `"und"` — ICU's locale-neutral root collation (see the options above). */
const LOCALE_COMPARE_LOCALE = "und";

function numCompare(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Ascending compare. For severity and priority "ascending" means LEAST
 * urgent first, so "descending" (the default) puts critical / P0 on top.
 */
function rawCompare(a: TriageItem, b: TriageItem, key: SortKey): number {
  switch (key) {
    case "severity":
      return numCompare(SEVERITY_RANK[b.severity] ?? 99, SEVERITY_RANK[a.severity] ?? 99);
    case "priority":
      return numCompare(
        Number(b.suggestedPriority.slice(1)),
        Number(a.suggestedPriority.slice(1)),
      );
    case "name":
      return a.title.localeCompare(b.title, LOCALE_COMPARE_LOCALE, LOCALE_COMPARE_OPTIONS);
    case "modified":
      // `ts` is the server-resolved latest-status-event time — never
      // `originalTs`. Raw comparison, not localeCompare: an ISO-8601 string
      // carries no human text and ICU punctuation weighting would make the
      // order vary by runtime locale.
      return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
  }
}

function directed(cmp: number, direction: SortDirection): number {
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Two-level sort with a trailing project + id tiebreak — a total order, so
 * "the first N" never depends on fetch/insertion order. Does not mutate.
 */
export function sortEntries(
  entries: TriageEntry[],
  sort: TriageSortState,
): TriageEntry[] {
  return [...entries].sort((a, b) => {
    const primary = directed(
      rawCompare(a.item, b.item, sort.primary.key),
      sort.primary.direction,
    );
    if (primary !== 0) return primary;
    const secondary = directed(
      rawCompare(a.item, b.item, sort.secondary.key),
      sort.secondary.direction,
    );
    if (secondary !== 0) return secondary;
    const ka = entryKey(a);
    const kb = entryKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
