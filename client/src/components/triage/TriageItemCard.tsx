/*
 * TriageItemCard.tsx — single-item card. Click → opens TriageDetailModal.
 *
 * All triage fields are rendered as plain text — no MarkdownText, no
 * dangerouslySetInnerHTML. XSS-safety mirror of MasterTaskCard's
 * domain-chip pattern from ADR-100.
 */

import type { TriageItem } from "../../lib/triageApi";
import { PendingDeliveryBadge, ReturnedBadge, SeverityBadge, SourceBadge } from "./TriageBadgeUI";

interface TriageItemCardProps {
  item: TriageItem;
  onClick: () => void;
}

/**
 * Best-effort relative-time formatter for the originalTs ISO timestamp.
 * Falls back to the raw ISO string on parse failure (defense in depth).
 */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.floor((Date.now() - t) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

export function TriageItemCard({ item, onClick }: TriageItemCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `block` is load-bearing: a <button> is `inline-block` by default, so it
      // sits on a LINE box and WebKit (iPad/iPhone Safari) adds baseline/descender
      // space under a card whose line-clamped text sets the baseline — a 170px+
      // empty gap after some cards (Sven, 2026-10-10). Chromium/Edge hide it.
      className="block w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] px-3 py-2 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
      data-nav-item
      data-testid={`triage-item-${item.id}`}
    >
      {/* Below 1500px the timestamp FOLLOWS the badge cluster (`ml-auto` only
          right-aligns it on a wide desktop): on a phone, tablet or ordinary
          laptop the card spans ~900px+, and `ml-auto` flung the time to the far
          edge, leaving a wide dead gap between a card's id/priority and its time
          (Sven, twice: "cards too far apart horizontally"). */}
      <div className="flex items-center gap-x-2 gap-y-0.5 mb-1 flex-wrap">
        <SourceBadge source={item.source} />
        <SeverityBadge severity={item.severity} />
        {item.pendingDelivery && <PendingDeliveryBadge />}
        {item.revisitDue && <ReturnedBadge />}
        <span className="text-[11px] text-[var(--color-muted)] font-mono">{item.id}</span>
        <span className="text-[11px] text-[var(--color-muted)]">
          → {item.suggestedPriority} / {item.suggestedDomain}
        </span>
        <span
          className="text-[11px] text-[var(--color-muted)] min-[1500px]:ml-auto"
          title={item.originalTs}
          data-testid={`triage-item-${item.id}-relative-ts`}
        >
          {formatRelative(item.originalTs)}
        </span>
      </div>
      <h3 className="text-sm font-medium leading-snug text-[var(--color-text)] mb-0.5">{item.title}</h3>
      <p className="text-xs leading-snug text-[var(--color-text)] line-clamp-2 whitespace-pre-wrap">
        {item.detail}
      </p>
      {item.dedupKey && (
        <p className="text-[10px] text-[var(--color-muted)] font-mono mt-1">
          dedup: {item.dedupKey}
        </p>
      )}
    </button>
  );
}
