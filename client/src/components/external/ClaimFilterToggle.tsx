/*
 * ClaimFilterToggle — board toolbar toggle limiting the list to claimed
 * tasks (FR-04.22, section 5.2, iterate-2026-09-02-claim-chip-filter).
 *
 * A claim is a chip and a filter, never a column change (resolveBoardColumn
 * is untouched) and never a fifth state value (the status filter's
 * ExternalTaskState vocabulary is unchanged) — this is its own, independent
 * axis, ANDed into useBoardFilters' filteredTasks. Mirrors the shell +
 * pressed-state idiom of LeadWaitToggleButton (LeadTagFilter.tsx): no menu
 * needed for a single binary condition.
 */
import { UserCheck } from "lucide-react";

interface ClaimFilterToggleProps {
  active: boolean;
  onToggle: () => void;
}

export function ClaimFilterToggle({ active, onToggle }: ClaimFilterToggleProps) {
  return (
    <button
      type="button"
      aria-label="Filter to claimed tasks"
      aria-pressed={active}
      data-testid="board-claim-filter-toggle"
      data-active={active || undefined}
      onClick={onToggle}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
    >
      <UserCheck size={15} />
    </button>
  );
}
