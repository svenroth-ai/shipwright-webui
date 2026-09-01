/*
 * Lead tag board filter — Bot dropdown + BellDot shortcut toggle.
 *
 * FR-04.11 (leadwright/spec/lead-model-spec.md, V3 row) asks for exactly
 * this: "Bot- und BellDot-Knopf im Werkzeugleisten-Muster" (Bot AND BellDot
 * button in the toolbar pattern) — two toolbar buttons, not two rows added
 * inside `BoardStatusFilter`'s own dropdown (see the iterate spec's
 * `## Design Notes` for the full reconciliation of a looser prose reading
 * of the same source spec that suggested otherwise, and `## Architecture
 * Review` for why an external-review suggestion to drop BellDot as
 * "redundant" was not adopted — it is a named deliverable, not a free
 * simplification).
 *
 * <LeadTagFilterMenu> mirrors <StatusFilterMenu> (BoardStatusFilter.tsx)
 * exactly: same trigger shell, same Radix DropdownMenu + CheckboxItem +
 * "All" reset row anatomy, same live-count convention (computed by the
 * caller from the project-filtered set, independent of this filter and of
 * `statusFilter` — TaskBoardPage.tsx mirrors `statusCounts`'s own
 * established convention for this reason).
 *
 * <LeadWaitToggleButton> (BellDot) is a shortcut for exactly the
 * `lead-wait:` entry above. It carries NO state of its own — its pressed
 * look is derived read-only from `active.has(LEAD_WAIT_TAG_PREFIX)` and its
 * click calls the exact same `onToggle` the menu's checkbox calls, so there
 * is nothing that can desync between the two controls.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BellDot, Bot, Check } from "lucide-react";

import {
  LEAD_DEDUP_TAG_PREFIX,
  LEAD_ORIGIN_TAG_PREFIX,
  LEAD_WAIT_TAG_PREFIX,
  type LeadTagPrefix,
} from "../../lib/leadTags";

export interface LeadTagFilterOption {
  value: LeadTagPrefix;
  label: string;
}

/** Order locked to the three closed-vocabulary prefixes (FR-04.10). */
export const LEAD_TAG_FILTER_OPTIONS: LeadTagFilterOption[] = [
  { value: LEAD_ORIGIN_TAG_PREFIX, label: "Lead-originated" },
  { value: LEAD_WAIT_TAG_PREFIX, label: "Waiting on PO" },
  { value: LEAD_DEDUP_TAG_PREFIX, label: "Dedup pending" },
];

interface LeadTagFilterProps {
  counts: Record<LeadTagPrefix, number>;
  /** Count shown on the "All" row — i.e. what clearing the filter reveals.
   * NOT the sum of the three per-prefix counts: unlike the status filter's
   * disjoint/exhaustive buckets, lead-tag prefixes can overlap (a task can
   * carry more than one) and are not exhaustive (a task can carry none), so
   * summing would double-count and under-represent (code review finding,
   * iterate-2026-09-01-lead-board-surface). Callers pass the size of the set
   * "All" actually renders. */
  total: number;
  active: Set<LeadTagPrefix>;
  onToggle: (value: LeadTagPrefix) => void;
  onReset: () => void;
}

/** The Bot toolbar button — opens the three-prefix filter menu. */
export function LeadTagFilterMenu({ counts, total, active, onToggle, onReset }: LeadTagFilterProps) {
  const hasActive = active.size > 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Filter by lead tag"
          data-testid="board-lead-filter-menu-trigger"
          data-active={hasActive || undefined}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
        >
          <Bot size={15} />
          {hasActive && (
            <span
              data-testid="board-lead-filter-menu-dot"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]"
            />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-testid="board-lead-filter-menu"
          className="z-50 min-w-[200px] rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm shadow-[var(--shadow-card)]"
        >
          <DropdownMenu.Label className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
            Filter by lead tag
          </DropdownMenu.Label>
          <DropdownMenu.Item
            onSelect={onReset}
            data-testid="board-lead-filter-menu-all"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[var(--color-text)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)]"
          >
            <span className="flex h-4 w-4 items-center justify-center text-[var(--color-primary)]">
              {!hasActive && <Check size={13} />}
            </span>
            <span className="flex-1">All</span>
            <span className="font-mono text-[10px] text-[var(--color-muted)]">{total}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
          {LEAD_TAG_FILTER_OPTIONS.map((opt) => (
            <DropdownMenu.CheckboxItem
              key={opt.value}
              checked={active.has(opt.value)}
              onCheckedChange={() => onToggle(opt.value)}
              onSelect={(e) => e.preventDefault()}
              data-testid={`board-lead-filter-menu-item-${tagTestId(opt.value)}`}
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

interface LeadWaitToggleProps {
  active: Set<LeadTagPrefix>;
  onToggle: (value: LeadTagPrefix) => void;
}

/** The BellDot toolbar button — a one-click shortcut for the "Waiting on
 *  PO" filter. Derives its pressed state from the SAME shared `active` Set
 *  the menu above reads, and calls the SAME `onToggle` — no independent
 *  state, nothing to keep in sync. */
export function LeadWaitToggleButton({ active, onToggle }: LeadWaitToggleProps) {
  const pressed = active.has(LEAD_WAIT_TAG_PREFIX);
  return (
    <button
      type="button"
      aria-label="Filter to tasks waiting on the PO"
      aria-pressed={pressed}
      data-testid="board-lead-wait-toggle"
      data-active={pressed || undefined}
      onClick={() => onToggle(LEAD_WAIT_TAG_PREFIX)}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
    >
      <BellDot size={15} />
    </button>
  );
}

function tagTestId(prefix: LeadTagPrefix): string {
  // "lead:" -> "lead", "lead-wait:" -> "lead-wait", "lead-dedup:" -> "lead-dedup"
  return prefix.slice(0, -1);
}
