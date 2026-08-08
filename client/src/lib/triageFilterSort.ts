/*
 * triageFilterSort.ts — pure, view-only filter/sort logic for the Triage
 * tab (iterate-2026-08-08-triage-filters-sort-parked). No store writes,
 * no network calls — every function here is a synchronous transform over
 * already-fetched `TriageItem[]` arrays.
 *
 * The two named exceptions to "Parked defaults to hidden" (see the
 * iterate spec's Design Notes / AC8 / AC9) live in
 * `selectVisibleOpenItems` and `selectVisibleDeferredItems` as explicit,
 * commented bypasses — not emergent behavior of a generic predicate.
 */

import type {
  TriageComplexityHint,
  TriageItem,
  TriagePriority,
} from "./triageApi";

export type ComplexityFilterValue = TriageComplexityHint | "unset";

export const COMPLEXITY_FILTER_VALUES: readonly ComplexityFilterValue[] = [
  "small",
  "medium",
  "large",
  "unset",
];

/**
 * `TriageItem` (server canonical: `server/src/types/triage.ts`, client
 * mirror: `triageApi.ts`) does not declare a complexity field — adding
 * one to either `interface TriageItem` block would both violate this
 * iterate's "no contract changes" constraint and trip the schema-sync
 * drift guard (`server/src/types/triage-schema-sync.test.ts`), which
 * fails the build the moment the two interfaces disagree. This
 * intersection type is scoped to this module only — the sync guard
 * parses just the named `interface` blocks, so it never sees this. See
 * the iterate spec's Design Notes for the forward-compatibility
 * reasoning and its verification.
 */
type TriageItemMaybeComplexity = TriageItem & {
  suggestedComplexity?: TriageComplexityHint;
};

/**
 * Reads + normalizes the forward-compat field at runtime, not just at the
 * type level: `TriageItemMaybeComplexity`'s cast asserts a shape nothing
 * checks, so an unpublished producer emitting a value outside
 * `small|medium|large` would otherwise pass through unfilterable — no
 * chip accounts for it, and no chip can ever exclude it (code-reviewer
 * finding). An unrecognized value classifies as "unset": visible,
 * filterable, honest, same as the not-yet-populated case.
 */
export function getComplexity(item: TriageItem): ComplexityFilterValue {
  const raw = (item as TriageItemMaybeComplexity).suggestedComplexity;
  return (COMPLEXITY_FILTER_VALUES as readonly string[]).includes(raw ?? "unset")
    ? (raw ?? "unset")
    : "unset";
}

/*
 * Filter semantics are EXCLUDE, not include (AC1/AC3 — a chip starts
 * active/visible; clicking it deselects/excludes that value). This
 * matches the Goal's framing ("has no way to hide what the operator has
 * decided not to do now") and is the only reading AC3 supports: "every
 * item classifies as Unset, and deselecting Unset hides every item" is
 * only possible if Unset starts selected (default = nothing excluded).
 * An include-by-selection model (nothing shown until a chip is clicked)
 * was shipped first and REJECTED at spec-reviewer Stage 1 — AC3's
 * "deselecting Unset hides items" has no reachable interaction under
 * include semantics, since Unset already starts deselected there.
 */
export interface TriageFilterState {
  /** Empty set = nothing excluded (show every priority). */
  excludedPriorities: ReadonlySet<TriagePriority>;
  /** Empty set = nothing excluded (show every domain). */
  excludedDomains: ReadonlySet<string>;
  /** Empty set = nothing excluded (show every complexity, incl. "unset"). */
  excludedComplexities: ReadonlySet<ComplexityFilterValue>;
  /** Parked is its own filter, not a value inside `excludedPriorities` (AC7). Default hidden. */
  showParked: boolean;
}

export const DEFAULT_FILTER_STATE: TriageFilterState = {
  excludedPriorities: new Set(),
  excludedDomains: new Set(),
  excludedComplexities: new Set(),
  showParked: false,
};

export function matchesAttributeFilters(
  item: TriageItem,
  filters: TriageFilterState,
): boolean {
  if (filters.excludedPriorities.has(item.suggestedPriority)) {
    return false;
  }
  if (filters.excludedDomains.has(item.suggestedDomain)) {
    return false;
  }
  if (filters.excludedComplexities.has(getComplexity(item))) {
    return false;
  }
  return true;
}

/**
 * "N" when nothing is filtered out, "N of M" (visible of total) when it
 * is — the one count-form convention for every heading whose visible
 * count can differ from its total (iterate spec, Design Notes: "Count
 * semantics — one convention, stated once").
 */
export function formatCount(visible: number, total: number): string {
  return visible === total ? `${total}` : `${visible} of ${total}`;
}

export interface VisibleSelection {
  visible: TriageItem[];
  /** Always `input.length - visible.length` — never a second predicate pass. */
  hiddenCount: number;
}

/**
 * Open (`status === "triage"`) items, filtered + the AC8 bypass.
 *
 * A due-parked item (`revisitDue === true`) has already been flipped to
 * `status: "triage"` upstream (`applyDeferOverlay`) before this ever
 * runs — it is mechanically part of `items` — but it can still be
 * excluded by Priority/Domain/Complexity like any coincidence. AC8
 * requires it survive every active filter regardless, and requires it
 * NOT be counted as hidden (it was shown, not hidden) — both are the
 * `||` bypass below, not two separate code paths.
 */
export function selectVisibleOpenItems(
  items: TriageItem[],
  filters: TriageFilterState,
): VisibleSelection {
  const visible = items.filter(
    (item) => item.revisitDue || matchesAttributeFilters(item, filters),
  );
  return { visible, hiddenCount: items.length - visible.length };
}

/**
 * Deferred (`status === "snoozed"`) items, filtered + the AC9 bypass.
 *
 * A dateless park (`revisitAt === null`) never becomes due — there is
 * no date to arrive — so without a standing exception it would be
 * hidden by the Parked-off default forever. AC9 requires it survive
 * that default specifically, while still respecting the attribute
 * filters like any other item — the AND below, not an unconditional
 * bypass.
 */
export function selectVisibleDeferredItems(
  items: TriageItem[],
  filters: TriageFilterState,
): VisibleSelection {
  const visible = items.filter((item) => {
    const passesParkedToggle = filters.showParked || item.revisitAt === null;
    return passesParkedToggle && matchesAttributeFilters(item, filters);
  });
  return { visible, hiddenCount: items.length - visible.length };
}

export type SortKey = "domain" | "name" | "modified";
export type SortDirection = "asc" | "desc";

export interface SortLevel {
  key: SortKey;
  direction: SortDirection;
}

export interface TriageSortState {
  primary: SortLevel;
  secondary: SortLevel;
}

export const DEFAULT_SORT_STATE: TriageSortState = {
  primary: { key: "modified", direction: "desc" },
  secondary: { key: "name", direction: "asc" },
};

/** Pinned so ordering never varies by runtime ICU locale (review finding). */
const LOCALE_COMPARE_OPTIONS: Intl.CollatorOptions = {
  sensitivity: "base",
  numeric: true,
};

/**
 * `"und"` — BCP 47 for "undetermined locale", ICU's own root/locale-neutral
 * collation. `LOCALE_COMPARE_OPTIONS` alone pins comparison *behavior*
 * (case/accent sensitivity, numeric-aware ordering) but passing `undefined`
 * for the locale itself still floats on the runtime's default ICU locale —
 * two locales can share those options and still collate certain characters
 * differently. External code-review cascade caught this: the options-only
 * pin left AC4's "ordering never varies by runtime locale" promise only
 * half kept.
 */
const LOCALE_COMPARE_LOCALE = "und";

function rawCompare(a: TriageItem, b: TriageItem, key: SortKey): number {
  switch (key) {
    case "domain":
      return a.suggestedDomain.localeCompare(
        b.suggestedDomain,
        LOCALE_COMPARE_LOCALE,
        LOCALE_COMPARE_OPTIONS,
      );
    case "name":
      return a.title.localeCompare(b.title, LOCALE_COMPARE_LOCALE, LOCALE_COMPARE_OPTIONS);
    case "modified":
      // `ts` is the server-resolved latest-status-event time (or append
      // time if never re-statused) — see triage-store.ts `resolveUnion`.
      // Never `originalTs` (frozen append time) — AC10. Raw comparison,
      // not localeCompare — an ISO-8601 timestamp carries no human text,
      // and ICU's locale-variable punctuation weighting on `-`/`:`/`+`
      // would reintroduce exactly the "ordering varies by runtime locale"
      // failure LOCALE_COMPARE_OPTIONS exists to prevent (code-reviewer
      // finding). Matches sortDeferred.ts and triage-store.ts's own `ts`
      // comparisons, both raw.
      return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
  }
}

function directed(cmp: number, direction: SortDirection): number {
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Two-level sort with a trailing `id` tiebreak — a total order, mirroring
 * `sortDeferred`'s existing pattern so "the first N" never depends on
 * fetch/insertion order. Does not mutate `items`.
 */
export function sortItems(
  items: TriageItem[],
  sort: TriageSortState,
): TriageItem[] {
  return [...items].sort((a, b) => {
    const primary = directed(
      rawCompare(a, b, sort.primary.key),
      sort.primary.direction,
    );
    if (primary !== 0) return primary;
    const secondary = directed(
      rawCompare(a, b, sort.secondary.key),
      sort.secondary.direction,
    );
    if (secondary !== 0) return secondary;
    // Raw, not localeCompare — an id carries no human text (same
    // rationale as the `modified` case above).
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
