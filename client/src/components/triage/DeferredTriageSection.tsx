/*
 * DeferredTriageSection.tsx — the "Deferred" section of the Triage tab
 * (monorepo P2.03 parity, iterate-2026-08-05-triage-deferred-envelope, AC6).
 *
 * Read-only in this iterate — view only, no Promote/Dismiss/Snooze from
 * here (see the iterate spec's Out of Scope). Clicking a card still opens
 * TriageDetailModal, which already hides its action row for any item whose
 * status isn't "triage" — no new gating needed.
 *
 * Every item here has `status === "snoozed"`, which by construction (the
 * server's `applyDeferOverlay` auto-resolves a due park back to `triage`
 * before this ever runs) means `revisitDue` is always `false` — a dated
 * entry is simply not due YET, an undated one never will be. The label
 * distinguishes the two: "Parked" (a return date is set) vs
 * "Parked — not due" (no date at all — the upstream-permitted no-date park).
 *
 * `hiddenCount` (iterate-2026-08-08-triage-filters-sort-parked, AC7):
 * the number of parked items suppressed by the current view — either the
 * Parked filter's default-hidden state, or the Priority/Domain/
 * Complexity attribute filters, summed into one number (deliberately
 * cause-agnostic — see the iterate spec's AC7 for why gating the hint on
 * the Parked toggle's own state would be wrong). Rendered whenever it is
 * greater than zero, INDEPENDENT of `items.length` — a project with some
 * parked items visible (via the AC9 dateless exception) and others
 * hidden must still show the hint for the hidden ones (plan-review fix).
 */

import type { TriageItem } from "../../lib/triageApi";
import { formatCount } from "../../lib/triageFilterSort";
import { SeverityBadge, SourceBadge } from "./TriageBadgeUI";

interface DeferredTriageSectionProps {
  items: TriageItem[];
  hiddenCount: number;
  onClick: (item: TriageItem) => void;
}

export function DeferredTriageSection({ items, hiddenCount, onClick }: DeferredTriageSectionProps) {
  if (items.length === 0 && hiddenCount === 0) return null;

  return (
    <div className="mb-4" data-testid="triage-deferred-section">
      <h3 className="text-xs font-semibold text-[var(--ink)] uppercase mb-2">
        Deferred ({formatCount(items.length, items.length + hiddenCount)})
      </h3>
      {hiddenCount > 0 && (
        // on-photo-legibility (spec-reviewer Stage 1 finding): this line, like
        // the `<h3>` above it, rides bare on the deck-golden photo — it must
        // use the flipping `--muted` token, not the legacy `--color-muted`
        // alias (computed at :root, stays dark → invisible on-photo). The
        // item-detail spans below stay on `--color-muted` correctly: they sit
        // inside the opaque `bg-[var(--color-surface)]` item buttons.
        <p
          className="text-[11px] text-[var(--muted)] mb-2"
          data-testid="triage-deferred-hidden-count"
        >
          {hiddenCount} parked item{hiddenCount === 1 ? "" : "s"} hidden by the current view.
        </p>
      )}
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onClick(item)}
            className="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-3 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
            data-nav-item
            data-testid={`triage-deferred-item-${item.id}`}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <SourceBadge source={item.source} />
              <SeverityBadge severity={item.severity} />
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-info-tint text-info border border-[var(--info-line)]"
                data-testid={`triage-deferred-item-${item.id}-state`}
              >
                {item.revisitAt ? "Parked" : "Parked — not due"}
              </span>
              <span className="text-[11px] text-[var(--color-muted)] font-mono">{item.id}</span>
            </div>
            <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">{item.title}</h4>
            <p
              className="text-[11px] text-[var(--color-muted)]"
              data-testid={`triage-deferred-item-${item.id}-revisit`}
            >
              {item.revisitAt ? `Returns on ${item.revisitAt}` : "No revisit date set"}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
