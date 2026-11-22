/*
 * InboxFilterBar — the chips on top of the Inbox (mockup page 01): "Open" (all)
 * and one chip per kind that has entries today. Each is a toggle (aria-pressed)
 * with its count; clicking a kind narrows the list, clicking it again (or
 * "Open") shows everything. A kind with no entries has no chip, so the bar never
 * offers a filter that would show an empty page. Colour is not the only signal:
 * the active chip is also announced by aria-pressed.
 */
import type { InboxFilter } from "./inboxRowModel";

const LABEL: Record<InboxFilter, string> = {
  all: "Open",
  awaiting: "Awaiting reply",
  reminders: "Reminders due",
  parked: "Parked triage",
  notices: "Notices",
};

export function InboxFilterBar({
  counts,
  active,
  onChange,
  damagedLines = 0,
}: {
  counts: Record<InboxFilter, number>;
  active: InboxFilter;
  onChange: (f: InboxFilter) => void;
  /** Damaged lines in the reminder file (a notice pill, not a toggle); shown only above 0. */
  damagedLines?: number;
}) {
  const kinds = (["awaiting", "reminders", "parked", "notices"] as const).filter((k) => counts[k] > 0);
  const chips: InboxFilter[] = ["all", ...kinds];
  return (
    <div className="inbox-filter-bar" role="group" aria-label="Filter the Inbox" data-testid="inbox-filter-bar">
      {chips.map((f) => (
        <button
          key={f}
          type="button"
          className="inbox-filter-chip"
          aria-pressed={active === f}
          onClick={() => onChange(f === active ? "all" : f)}
          data-testid={`inbox-filter-${f}`}
        >
          <b>{counts[f]}</b> {LABEL[f]}
        </button>
      ))}
      {damagedLines > 0 && (
        <span className="inbox-filter-warn" data-testid="inbox-filter-damaged">
          <span aria-hidden="true">{"⚠"}</span>
          {damagedLines} damaged reminder {damagedLines === 1 ? "line" : "lines"}
        </span>
      )}
    </div>
  );
}
