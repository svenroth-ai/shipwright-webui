/*
 * TriageViewMenus — the Group and Sort menus of the Triage header
 * (iterate-2026-11-08-triage-page-redesign). Group is a single-select
 * Radix menu (None / Project / Severity / Source / Priority); Sort is a
 * popover with TWO levels, each a key select plus its own ascending /
 * descending switch.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, Check, ChevronDown } from "lucide-react";

import type { TriageViewState } from "../../hooks/useTriageViewState";
import { SORT_KEYS, type SortLevel } from "../../lib/triageFilterSort";
import { GROUP_BY_VALUES, type GroupBy } from "../../lib/triageGrouping";
import {
  MENU_CHECK,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_LABEL,
  TOOLBAR_BUTTON,
} from "./triageMenuStyles";

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TriageGroupMenu({
  groupBy,
  onChange,
}: {
  groupBy: GroupBy;
  onChange: (g: GroupBy) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="triage-group-trigger"
          data-active={groupBy !== "project" || undefined}
          className={TOOLBAR_BUTTON}
        >
          Group: {cap(groupBy)}
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="triage-group-menu"
          className={MENU_CONTENT}
        >
          <DropdownMenu.Label className={MENU_LABEL}>Group by</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={groupBy} onValueChange={(v) => onChange(v as GroupBy)}>
            {GROUP_BY_VALUES.map((g) => (
              <DropdownMenu.RadioItem
                key={g}
                value={g}
                data-testid={`triage-group-${g}`}
                className={MENU_ITEM}
              >
                <span className={MENU_CHECK}>
                  <DropdownMenu.ItemIndicator>
                    <Check size={13} />
                  </DropdownMenu.ItemIndicator>
                </span>
                {cap(g)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SortRow({
  label,
  level,
  onChange,
  testId,
}: {
  label: string;
  level: SortLevel;
  onChange: (l: SortLevel) => void;
  testId: string;
}) {
  const desc = level.direction === "desc";
  return (
    <div className="grid gap-1">
      <span className={MENU_LABEL}>{label}</span>
      <div className="flex items-center gap-1.5 px-1">
        <select
          aria-label={label}
          value={level.key}
          onChange={(e) => onChange({ ...level, key: e.target.value as SortLevel["key"] })}
          data-testid={`${testId}-key`}
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {cap(k)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onChange({ ...level, direction: desc ? "asc" : "desc" })}
          aria-label={`Direction: ${desc ? "descending" : "ascending"}`}
          title={desc ? "Descending" : "Ascending"}
          data-testid={`${testId}-dir`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)]"
        >
          {desc ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
        </button>
      </div>
    </div>
  );
}

export function TriageSortMenu({ view }: { view: TriageViewState }) {
  const p = view.sort.primary;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" data-testid="triage-sort-trigger" className={TOOLBAR_BUTTON}>
          Sort: {cap(p.key)} {p.direction === "desc" ? "↓" : "↑"}
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          data-testid="triage-sort-menu"
          className={`${MENU_CONTENT} grid w-[240px] gap-2 p-2`}
        >
          <SortRow label="Sort by" level={view.sort.primary} onChange={view.setPrimarySort} testId="triage-sort-primary" />
          <SortRow label="Then by" level={view.sort.secondary} onChange={view.setSecondarySort} testId="triage-sort-secondary" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
