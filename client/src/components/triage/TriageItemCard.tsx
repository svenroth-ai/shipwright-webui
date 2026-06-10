/*
 * TriageItemCard.tsx — single-item card. Click → opens TriageDetailModal.
 *
 * All triage fields are rendered as plain text — no MarkdownText, no
 * dangerouslySetInnerHTML. XSS-safety mirror of MasterTaskCard's
 * domain-chip pattern from ADR-100.
 */

import type { TriageItem } from "../../lib/triageApi";
import { PendingDeliveryBadge, SeverityBadge, SourceBadge } from "./TriageBadgeUI";

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
      className="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-3 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card-hover)] transition-shadow"
      data-testid={`triage-item-${item.id}`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <SourceBadge source={item.source} />
        <SeverityBadge severity={item.severity} />
        {item.pendingDelivery && <PendingDeliveryBadge />}
        <span className="text-[11px] text-stone-500 font-mono">{item.id}</span>
        <span className="text-[11px] text-stone-500">
          → {item.suggestedPriority} / {item.suggestedDomain}
        </span>
        <span
          className="text-[11px] text-stone-400 ml-auto"
          title={item.originalTs}
          data-testid={`triage-item-${item.id}-relative-ts`}
        >
          {formatRelative(item.originalTs)}
        </span>
      </div>
      <h3 className="text-sm font-medium text-stone-900 mb-1">{item.title}</h3>
      <p className="text-xs text-stone-600 line-clamp-2 whitespace-pre-wrap">
        {item.detail}
      </p>
      {item.dedupKey && (
        <p className="text-[10px] text-stone-400 font-mono mt-1.5">
          dedup: {item.dedupKey}
        </p>
      )}
    </button>
  );
}
