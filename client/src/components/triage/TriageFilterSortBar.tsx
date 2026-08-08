/*
 * TriageFilterSortBar.tsx — the Triage tab's filter + sort controls
 * (iterate-2026-08-08-triage-filters-sort-parked). A thin host: it owns
 * no filter/sort logic itself (that lives in `triageFilterSort.ts` /
 * `useTriageViewState.ts`) — just renders TriageFilterGroup ×4 and
 * TriageSortLevel ×2 wired to the view-state object.
 *
 * The Complexity group is ALWAYS rendered, even though every item
 * resolves to "unset" today — an explicit, direct 2026-08-07 operator
 * decision (see the iterate spec's Design Notes), not an oversight.
 *
 * `view.filters.excluded*` are EXCLUDE sets (AC1/AC3 — see
 * triageFilterSort.ts), but `TriageFilterGroup` is a dumb "highlight
 * what's in `selected`, toggle on click" component with no opinion on
 * exclude-vs-include. This file is the one place that reconciles the
 * two: it computes each dimension's ACTIVE set (every known value minus
 * the excluded ones) and passes THAT as `selected`, so a chip starts
 * highlighted (visible) and un-highlights when clicked (excluded) —
 * `onToggle` still just flips exclusion-set membership either way.
 */

import { TriageFilterGroup } from "./TriageFilterGroup";
import { TriageSortLevel } from "./TriageSortLevel";
import { COMPLEXITY_FILTER_VALUES, type ComplexityFilterValue } from "../../lib/triageFilterSort";
import type { TriageViewState } from "../../hooks/useTriageViewState";
import type { TriagePriority } from "../../lib/triageApi";

const PRIORITY_OPTIONS: readonly { value: TriagePriority; label: string }[] = [
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

const COMPLEXITY_LABELS: Record<ComplexityFilterValue, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  unset: "Unset",
};

const COMPLEXITY_OPTIONS: readonly { value: ComplexityFilterValue; label: string }[] =
  COMPLEXITY_FILTER_VALUES.map((value) => ({ value, label: COMPLEXITY_LABELS[value] }));

const PARKED_OPTION = [{ value: "parked" as const, label: "Parked" }];

/** Every known value for a dimension minus its excluded set — see the file docstring. */
function activeSet<T>(allValues: readonly T[], excluded: ReadonlySet<T>): Set<T> {
  return new Set(allValues.filter((v) => !excluded.has(v)));
}

interface TriageFilterSortBarProps {
  view: TriageViewState;
  availableDomains: readonly string[];
}

export function TriageFilterSortBar({ view, availableDomains }: TriageFilterSortBarProps) {
  const domainOptions = availableDomains.map((d) => ({ value: d, label: d }));

  return (
    <div
      className="mb-4 flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-testid="triage-filter-sort-bar"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TriageFilterGroup
          label="Priority"
          options={PRIORITY_OPTIONS}
          selected={activeSet(
            PRIORITY_OPTIONS.map((o) => o.value),
            view.filters.excludedPriorities,
          )}
          onToggle={view.togglePriority}
          testIdPrefix="triage-filter-priority"
        />
        <TriageFilterGroup
          label="Domain"
          options={domainOptions}
          selected={activeSet(availableDomains, view.filters.excludedDomains)}
          onToggle={view.toggleDomain}
          testIdPrefix="triage-filter-domain"
        />
        <TriageFilterGroup
          label="Complexity"
          options={COMPLEXITY_OPTIONS}
          selected={activeSet(
            COMPLEXITY_FILTER_VALUES,
            view.filters.excludedComplexities,
          )}
          onToggle={view.toggleComplexity}
          testIdPrefix="triage-filter-complexity"
        />
        <TriageFilterGroup
          label=""
          options={PARKED_OPTION}
          selected={view.filters.showParked ? new Set<"parked">(["parked"]) : new Set<"parked">()}
          onToggle={() => view.setShowParked(!view.filters.showParked)}
          testIdPrefix="triage-filter-parked"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TriageSortLevel
          label="Sort open items"
          ariaLabel="Primary"
          level={view.sort.primary}
          onChange={view.setPrimarySort}
          testIdPrefix="triage-sort-primary"
        />
        <TriageSortLevel
          label="then"
          ariaLabel="Secondary"
          level={view.sort.secondary}
          onChange={view.setSecondarySort}
          testIdPrefix="triage-sort-secondary"
        />
      </div>
    </div>
  );
}
