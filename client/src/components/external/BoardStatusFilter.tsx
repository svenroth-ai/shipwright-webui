/*
 * Board status filter — the per-state task filter on the Task Board.
 *
 * <StatusFilterMenu> is the SOLE presentation on EVERY viewport (the compact
 * filter-icon funnel from the prototype `Spec/prototype/screens/board.js`
 * `filterBtn()` / `__filterMenu`). It opens a dropdown: an "All" row (resets)
 * + one multi-select checkbox per ExternalTaskState, each with its live count
 * and a ✓ on the active ones.
 *
 * on-photo-legibility fix (2026-07-17): the old top-left <StatusPillRow> chip
 * strip rode bare on the deck-golden photo (its semantic tone chips fell below
 * AA on the sky / rigging). It is RETIRED in favour of this funnel, which lives
 * in the taupe PageHead (`.chrome-dark-controls` flips it light) on all widths.
 * Filtering BEHAVIOUR is byte-for-byte unchanged: same 7 states, same counts,
 * same result set — a relocation + affordance restyle, not a new capability.
 *
 * The multi-select Set lives in TaskBoardPage and is passed in. Extracted from
 * TaskBoardPage so the page stays under its bloat-baseline line budget.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Filter } from "lucide-react";

import type { ExternalTaskState } from "../../lib/externalApi";

export interface StatusFilterOption {
  value: ExternalTaskState;
  label: string;
}

/** Order locked to the 7 valid ExternalTaskState values; labels lowercased
 *  to match our existing StatePill vocabulary. */
export const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: "draft", label: "draft" },
  { value: "awaiting_external_start", label: "awaiting" },
  { value: "active", label: "active" },
  { value: "idle", label: "idle" },
  { value: "done", label: "done" },
  { value: "launch_failed", label: "launch-failed" },
  { value: "jsonl_missing", label: "jsonl-missing" },
];

interface BoardStatusFilterProps {
  counts: Record<ExternalTaskState, number>;
  active: Set<ExternalTaskState>;
  onToggle: (value: ExternalTaskState) => void;
  onReset: () => void;
}

/** The compact funnel opening a multi-select status menu (the prototype's
 *  `filterBtn()` / `__filterMenu`). preventDefault on each item keeps the menu
 *  open across toggles (plan-review M3); an accent dot marks an active filter.
 *  Rendered on EVERY viewport since the on-photo-legibility fix. */
export function StatusFilterMenu({ counts, active, onToggle, onReset }: BoardStatusFilterProps) {
  const hasActive = active.size > 0;
  const total = STATUS_FILTER_OPTIONS.reduce((n, o) => n + (counts[o.value] ?? 0), 0);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Filter by status"
          data-testid="board-filter-menu-trigger"
          data-active={hasActive || undefined}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
        >
          <Filter size={15} />
          {hasActive && (
            <span
              data-testid="board-filter-menu-dot"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]"
            />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="board-filter-menu"
          className="z-50 min-w-[180px] rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm shadow-[var(--shadow-card)]"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
            Filter by status
          </DropdownMenu.Label>
          {/* "All" = clear the filter (prototype `__filterMenu` first row);
              ✓ marks it when nothing is selected, and it shows the total. */}
          <DropdownMenu.Item
            onSelect={onReset}
            data-testid="board-filter-menu-all"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]"
          >
            <span className="flex h-4 w-4 items-center justify-center text-[var(--color-primary)]">
              {!hasActive && <Check size={13} />}
            </span>
            <span className="flex-1">All</span>
            <span className="font-mono text-[10px] text-[var(--color-muted)]">{total}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <DropdownMenu.CheckboxItem
              key={opt.value}
              checked={active.has(opt.value)}
              onCheckedChange={() => onToggle(opt.value)}
              onSelect={(e) => e.preventDefault()}
              data-testid={`board-filter-menu-item-${opt.value}`}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]"
            >
              <span className="flex h-4 w-4 items-center justify-center text-[var(--color-primary)]">
                <DropdownMenu.ItemIndicator>
                  <Check size={13} />
                </DropdownMenu.ItemIndicator>
              </span>
              <span className="flex-1">{opt.label}</span>
              <span className="font-mono text-[10px] text-[var(--color-muted)]">
                {counts[opt.value]}
              </span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
