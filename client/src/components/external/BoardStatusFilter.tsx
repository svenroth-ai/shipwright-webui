/*
 * Board status filter — the per-state task filter on the Task Board.
 *
 * Two presentations over the SAME state (the multi-select Set lives in
 * TaskBoardPage and is passed in):
 *   - <StatusPillRow>   — the chip row shown ≥768px (unchanged behavior).
 *   - <StatusFilterMenu> — a funnel icon + dropdown shown on phones, where the
 *                          header has no room for a pill row
 *                          (iterate-2026-06-15-mobile-tablet-layout-polish AC-2).
 *
 * Extracted out of TaskBoardPage in the same iterate so the page stays under
 * its bloat-baseline line budget.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Filter } from "lucide-react";

import type { ExternalTaskState } from "../../lib/externalApi";

/** Muted / warning / error-tone accents matching the mockup filter row. */
export type ChipTone = "neutral" | "warning" | "success" | "error";

export interface StatusFilterOption {
  value: ExternalTaskState;
  label: string;
  tone: ChipTone;
}

/** Order locked to the 7 valid ExternalTaskState values; labels lowercased
 *  to match our existing StatePill vocabulary. */
export const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: "draft", label: "draft", tone: "neutral" },
  { value: "awaiting_external_start", label: "awaiting", tone: "warning" },
  { value: "active", label: "active", tone: "warning" },
  { value: "idle", label: "idle", tone: "neutral" },
  { value: "done", label: "done", tone: "success" },
  { value: "launch_failed", label: "launch-failed", tone: "error" },
  { value: "jsonl_missing", label: "jsonl-missing", tone: "error" },
];

interface BoardStatusFilterProps {
  counts: Record<ExternalTaskState, number>;
  active: Set<ExternalTaskState>;
  onToggle: (value: ExternalTaskState) => void;
  onReset: () => void;
}

interface StatusChipProps {
  label: string;
  value: ExternalTaskState;
  count: number;
  active: boolean;
  tone: ChipTone;
  onClick: (value: ExternalTaskState) => void;
}

/** Thin chip following `.chip` from the mockup. Active + hover share the
 *  `--color-primary` accent; `tone` colors the border + count slot. */
function StatusChip({ label, value, count, active, tone, onClick }: StatusChipProps) {
  const toneStyle =
    tone === "error"
      ? { color: "var(--color-error)", borderColor: "rgba(220,38,38,0.25)" }
      : tone === "warning"
        ? { color: "var(--color-warning-text)", borderColor: "var(--color-border)" }
        : tone === "success"
          ? { color: "var(--color-success-text)", borderColor: "var(--color-border)" }
          : { color: "var(--color-muted)", borderColor: "var(--color-border)" };
  const activeStyle = active
    ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
    : {};
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      data-testid={`board-filter-status-${value}`}
      data-active={active || undefined}
      aria-pressed={active}
      className="inline-flex items-center gap-[5px] rounded-[12px] border bg-transparent px-[10px] py-[3px] text-[11.5px] font-medium transition-colors hover:bg-[var(--color-muted-bg)]"
      style={{ ...toneStyle, ...activeStyle }}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px]" style={{ opacity: active ? 1 : 0.8 }}>
        {count}
      </span>
    </button>
  );
}

/** The chip row (≥768px). Own `.page-container` row with a single bottom border. */
export function StatusPillRow({ counts, active, onToggle, onReset }: BoardStatusFilterProps) {
  return (
    <div
      className="page-container flex flex-wrap items-center gap-2"
      style={{ paddingTop: "4px", paddingBottom: "16px" }}
    >
      <span
        className="min-w-[46px] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-muted)]"
        data-testid="board-filter-status"
      >
        Status
      </span>
      {STATUS_FILTER_OPTIONS.map((opt) => (
        <StatusChip
          key={opt.value}
          label={opt.label}
          value={opt.value}
          count={counts[opt.value]}
          active={active.has(opt.value)}
          onClick={onToggle}
          tone={opt.tone}
        />
      ))}
      {active.size > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="ml-1 rounded-[6px] px-2 py-[3px] text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[rgba(220,38,38,0.06)] hover:text-[var(--color-error)]"
          title="Reset status filter"
          data-testid="board-filter-status-reset"
        >
          Reset
        </button>
      )}
    </div>
  );
}

/** Phone presentation — a funnel icon opening a multi-select status menu.
 *  preventDefault on each item keeps the menu open across toggles (plan-review
 *  M3); an accent dot marks an active filter. */
export function StatusFilterMenu({ counts, active, onToggle, onReset }: BoardStatusFilterProps) {
  const hasActive = active.size > 0;
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
          {hasActive && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
              <DropdownMenu.Item
                onSelect={onReset}
                data-testid="board-filter-menu-reset"
                className="cursor-pointer rounded px-2 py-1.5 text-[var(--color-muted)] outline-none data-[highlighted]:bg-[var(--color-muted-bg)] data-[highlighted]:text-[var(--color-error)]"
              >
                Reset filter
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
