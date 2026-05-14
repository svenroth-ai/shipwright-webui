interface TriageBadgeProps {
  count: number;
}

/**
 * Sidebar badge for the Triage tab. Mirrors `<InboxBadge>` shape but uses
 * orange (vs Inbox red) so the two surfaces are visually distinct.
 */
export function TriageBadge({ count }: TriageBadgeProps) {
  if (count === 0) return null;

  const display = count > 99 ? "99+" : String(count);

  return (
    <span
      className="min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[11px] font-semibold flex items-center justify-center px-1"
      data-testid="triage-badge"
    >
      {display}
    </span>
  );
}
