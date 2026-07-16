interface InboxBadgeProps {
  count: number;
}

export function InboxBadge({ count }: InboxBadgeProps) {
  if (count === 0) return null;

  const display = count > 99 ? '99+' : String(count);

  // A05/AC5: --err-solid ground kept (spec §1), but the label is --ink (dark),
  // not white — white-on-err-solid is 3.76:1 and white-on-warn-solid 2.35:1
  // (both sub-AA). Dark-on-solid clears 5.0–7.5:1 and reads better on the
  // saturated hue. Verified in tokens.contrast.test.ts.
  return (
    <span className="min-w-[18px] h-[18px] rounded-full bg-[var(--err-solid)] text-ink text-[11px] font-semibold flex items-center justify-center px-1">
      {display}
    </span>
  );
}
