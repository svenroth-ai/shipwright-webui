interface InboxBadgeProps {
  count: number;
  /**
   * Some project's reminders / parked triage could not be read. The number is then only what WAS read, so a
   * "!" says so on every page, not just on the Inbox (reminders-webui follow-up). With nothing to count the
   * badge is the "!" alone, so an unreadable answer never looks like an empty inbox.
   */
  problem?: boolean;
}

export function InboxBadge({ count, problem = false }: InboxBadgeProps) {
  if (count === 0 && !problem) return null;

  const display = count > 99 ? '99+' : String(count);

  // A05/AC5: --err-solid ground kept (spec §1), but the label is --ink (dark),
  // not white — white-on-err-solid is 3.76:1 and white-on-warn-solid 2.35:1
  // (both sub-AA). Dark-on-solid clears 5.0–7.5:1 and reads better on the
  // saturated hue. Verified in tokens.contrast.test.ts.
  return (
    <span
      className="min-w-[18px] h-[18px] rounded-full bg-[var(--err-solid)] text-ink text-[11px] font-semibold flex items-center justify-center px-1"
      data-testid={problem ? 'inbox-badge-problem' : undefined}
      title={problem ? 'Some reminders could not be read. Open the Inbox for details.' : undefined}
    >
      {count > 0 && display}
      {problem && <span aria-hidden="true">!</span>}
      {problem && <span className="sr-only">{count > 0 ? ", " : ""}some reminders could not be read</span>}
    </span>
  );
}
