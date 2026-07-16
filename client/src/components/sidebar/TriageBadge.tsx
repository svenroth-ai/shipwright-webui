interface TriageBadgeProps {
  count: number;
}

/**
 * Sidebar badge for the Triage tab. Mirrors `<InboxBadge>` shape but uses
 * orange (vs Inbox red) so the two surfaces are visually distinct.
 *
 * External code review LOW: clamps to >= 0 so an upstream corruption that
 * yields a negative count produces a hidden badge instead of a nonsense
 * "-3" label.
 */
export function TriageBadge({ count }: TriageBadgeProps) {
  const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  if (safe === 0) return null;

  const display = safe > 99 ? "99+" : String(safe);

  // A05/AC5: --warn-solid ground kept (spec §1), but the label is --ink (dark) —
  // white-on-warn-solid is only 2.35:1 (sub-AA); dark-on-warn-solid is 7.5:1.
  // Verified in tokens.contrast.test.ts.
  return (
    <span
      className="min-w-[18px] h-[18px] rounded-full bg-[var(--warn-solid)] text-ink text-[11px] font-semibold flex items-center justify-center px-1"
      data-testid="triage-badge"
    >
      {display}
    </span>
  );
}
