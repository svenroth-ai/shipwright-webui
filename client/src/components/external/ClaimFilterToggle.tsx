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
 *
 * Gated on org-chart presence (iterate-2026-09-26-runtime-badge-and-leads-gate),
 * mirroring LeadTagFilterToolbarGroup's precedent (FR-04.11, itself
 * iterate-2026-09-09-leadwright-gate-org-presence): `claimedBy`/`claimToken`
 * are exclusively set by leadwright's claim-task mechanism
 * (lead-model-spec.md §5.2/§10.9) — an install with no leads has nothing
 * for this filter to filter by, so the control itself (not any per-task
 * data) is chrome for a feature that doesn't exist. Hidden ONLY on a
 * confirmed "absent" — "loading"/"broken" still render, fail visible rather
 * than fail hidden, same as the Bot/BellDot pair.
 */
import { UserCheck } from "lucide-react";

import { useOrgChartPresence } from "../../hooks/useOrgChartPresence";

interface ClaimFilterToggleProps {
  active: boolean;
  onToggle: () => void;
}

export function ClaimFilterToggle({ active, onToggle }: ClaimFilterToggleProps) {
  const presence = useOrgChartPresence();
  if (presence === "absent") return null;
  return (
    <button
      type="button"
      aria-label="Filter to claimed tasks"
      aria-pressed={active}
      data-testid="board-claim-filter-toggle"
      data-active={active || undefined}
      onClick={onToggle}
      // pointer-coarse:min-h-[44px] — touch-target floor (height only; see
      // ViewToggle.tsx for the width-exemption rationale this shares).
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] pointer-coarse:min-h-[44px] border-[1.5px] border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-text)] data-[active]:border-[var(--color-primary)] data-[active]:text-[var(--color-primary)]"
    >
      <UserCheck size={15} />
    </button>
  );
}
