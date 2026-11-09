/*
 * TriageFilterMenu — the funnel on the Triage header, modelled on the
 * Board's StatusFilterMenu: a Radix multi-select checkbox menu, nothing
 * ticked = show everything, ticked = show only those, an accent dot while a
 * filter is active, live counts per value
 * (iterate-2026-11-08-triage-page-redesign).
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Filter } from "lucide-react";

import type { FilterGroup, TriageViewState } from "../../hooks/useTriageViewState";
import {
  COMPLEXITY_FILTER_VALUES,
  PRIORITY_VALUES,
  SEVERITY_VALUES,
  activeFilterCount,
} from "../../lib/triageFilterSort";
import { optionValues, type Facets } from "../../lib/triageFacets";
import { sourceLabel } from "../../lib/triageHelpText";
import {
  MENU_CHECK,
  MENU_CONTENT,
  MENU_COUNT,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
  TOOLBAR_ICON_BUTTON,
} from "./triageMenuStyles";

interface Props {
  view: TriageViewState;
  facets: Facets;
  /** Parked items in scope (shown next to the "Show parked" switch). */
  parkedCount: number;
}

interface Section {
  group: FilterGroup;
  label: string;
  values: string[];
  counts: Record<string, number>;
  format?: (v: string) => string;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TriageFilterMenu({ view, facets, parkedCount }: Props) {
  const f = view.filters;
  const active = activeFilterCount(f);
  const sections: Section[] = [
    { group: "severities", label: "Severity", counts: facets.severities, format: cap, values: optionValues(facets.severities, f.severities, SEVERITY_VALUES) },
    { group: "sources", label: "Source", counts: facets.sources, format: sourceLabel, values: optionValues(facets.sources, f.sources) },
    { group: "priorities", label: "Priority", counts: facets.priorities, values: optionValues(facets.priorities, f.priorities, PRIORITY_VALUES) },
    { group: "domains", label: "Domain", counts: facets.domains, values: optionValues(facets.domains, f.domains) },
    { group: "complexities", label: "Complexity", counts: facets.complexities, format: cap, values: optionValues(facets.complexities, f.complexities, COMPLEXITY_FILTER_VALUES) },
  ];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Filter"
          data-testid="triage-filter-menu-trigger"
          data-active={active > 0 || undefined}
          className={TOOLBAR_ICON_BUTTON}
        >
          <Filter size={15} />
          {active > 0 && (
            <span
              data-testid="triage-filter-menu-dot"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]"
            />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="triage-filter-menu"
          className={MENU_CONTENT}
        >
          {sections.map((s, i) => (
            <div key={s.group}>
              {i > 0 && <DropdownMenu.Separator className={MENU_SEPARATOR} />}
              <DropdownMenu.Label className={MENU_LABEL}>{s.label}</DropdownMenu.Label>
              {s.values.map((v) => (
                <DropdownMenu.CheckboxItem
                  key={v}
                  checked={(f[s.group] as ReadonlySet<string>).has(v)}
                  onCheckedChange={() => view.toggleFilter(s.group, v)}
                  onSelect={(e) => e.preventDefault()}
                  data-testid={`triage-filter-${s.group}-${v}`}
                  className={MENU_ITEM}
                >
                  <span className={MENU_CHECK}>
                    <DropdownMenu.ItemIndicator>
                      <Check size={13} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span className="flex-1">{s.format ? s.format(v) : v}</span>
                  <span className={MENU_COUNT}>{s.counts[v] ?? 0}</span>
                </DropdownMenu.CheckboxItem>
              ))}
            </div>
          ))}
          <DropdownMenu.Separator className={MENU_SEPARATOR} />
          <DropdownMenu.CheckboxItem
            checked={f.showParked}
            onCheckedChange={(v) => view.setShowParked(v === true)}
            onSelect={(e) => e.preventDefault()}
            data-testid="triage-filter-show-parked"
            className={MENU_ITEM}
          >
            <span className={MENU_CHECK}>
              <DropdownMenu.ItemIndicator>
                <Check size={13} />
              </DropdownMenu.ItemIndicator>
            </span>
            <span className="flex-1">Show parked</span>
            <span className={MENU_COUNT}>{parkedCount}</span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className={MENU_SEPARATOR} />
          <DropdownMenu.Item
            onSelect={view.resetView}
            data-testid="triage-filter-reset-view"
            className={MENU_ITEM}
          >
            <span className={MENU_CHECK} />
            <span className="flex-1">Reset view</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
