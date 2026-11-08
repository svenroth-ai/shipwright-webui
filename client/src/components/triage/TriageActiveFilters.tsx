/*
 * TriageActiveFilters — the "Showing N of M" line with a removable chip per
 * ticked filter value and a "Clear filters" link
 * (iterate-2026-11-08-triage-page-redesign). Ticked values that no longer
 * exist in the data still show as chips, so an invisible filter can never
 * explain an empty list.
 */

import { X } from "lucide-react";

import type { FilterGroup, TriageViewState } from "../../hooks/useTriageViewState";
import { activeFilterCount } from "../../lib/triageFilterSort";
import { sourceLabel } from "../../lib/triageHelpText";

interface Props {
  view: TriageViewState;
  shown: number;
  total: number;
  /** Extra chip from a summary tile (Critical + High). */
  tileLabel?: string | null;
  onClearTile?: () => void;
}

const GROUPS: { group: FilterGroup; label: string; format?: (v: string) => string }[] = [
  { group: "severities", label: "Severity", format: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  { group: "sources", label: "Source", format: sourceLabel },
  { group: "priorities", label: "Priority" },
  { group: "domains", label: "Domain" },
  { group: "complexities", label: "Complexity", format: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
];

export function TriageActiveFilters({ view, shown, total, tileLabel, onClearTile }: Props) {
  const active = activeFilterCount(view.filters) + (tileLabel ? 1 : 0);
  if (active === 0) return null;
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]"
      data-testid="triage-active-filters"
    >
      <span data-testid="triage-showing-count">
        Showing <b className="text-[var(--color-text)]">{shown}</b> of {total}
      </span>
      {GROUPS.flatMap(({ group, label, format }) =>
        [...(view.filters[group] as ReadonlySet<string>)].map((v) => (
          <span
            key={`${group}:${v}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] py-0.5 pl-2 pr-1 text-[var(--color-text)]"
            data-testid={`triage-chip-${group}-${v}`}
          >
            {label}: {format ? format(v) : v}
            <button
              type="button"
              aria-label={`Remove ${label} filter ${v}`}
              onClick={() => view.toggleFilter(group, v)}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--color-muted-bg)]"
            >
              <X size={11} />
            </button>
          </span>
        )),
      )}
      {tileLabel && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] py-0.5 pl-2 pr-1 text-[var(--color-text)]"
          data-testid="triage-chip-tile"
        >
          {tileLabel}
          <button
            type="button"
            aria-label="Remove tile filter"
            onClick={onClearTile}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--color-muted-bg)]"
          >
            <X size={11} />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          view.clearFilters();
          onClearTile?.();
        }}
        className="underline hover:text-[var(--color-text)]"
        data-testid="triage-clear-filters"
      >
        Clear filters
      </button>
    </div>
  );
}
