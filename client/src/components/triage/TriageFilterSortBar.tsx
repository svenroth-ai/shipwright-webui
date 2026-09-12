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

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { TriageFilterGroup } from "./TriageFilterGroup";
import { TriageSortLevel } from "./TriageSortLevel";
import { COMPLEXITY_FILTER_VALUES, type ComplexityFilterValue } from "../../lib/triageFilterSort";
import { useIsPhoneViewport } from "../../hooks/useIsCompactViewport";
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
  // iterate-2026-09-12-mobile-triage-form-layout: on phone (<768px) the
  // filter/sort content is collapsed by default behind a toggle to save
  // vertical space above the triage list — mirrors MoreOptionsDisclosure's
  // pattern. `useIsPhoneViewport()` initializes synchronously from
  // `window.matchMedia` (see useIsCompactViewport.ts), so there is no
  // expanded-then-collapse flash on first paint. At >=768px `isPhone` is
  // always false, the toggle never renders, and content is always visible
  // — behaviorally identical to before this change.
  const isPhone = useIsPhoneViewport();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const contentVisible = !isPhone || phoneOpen;

  return (
    <div
      className="mb-4 max-md:mb-2 flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-testid="triage-filter-sort-bar"
    >
      {isPhone && (
        <button
          type="button"
          data-testid="triage-filter-sort-toggle"
          onClick={() => setPhoneOpen((open) => !open)}
          aria-expanded={phoneOpen}
          className="flex w-full items-center justify-between gap-2 pointer-coarse:min-h-[44px] text-left text-sm font-medium text-[var(--color-text)]"
        >
          <span>Filters &amp; sort</span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`flex-shrink-0 transition-transform ${phoneOpen ? "rotate-180" : ""}`}
          />
        </button>
      )}
      {contentVisible && (
        <>
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
        </>
      )}
    </div>
  );
}
