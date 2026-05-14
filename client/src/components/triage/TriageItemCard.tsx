/*
 * TriageItemCard.tsx — single-item card. Click → opens TriageDetailModal.
 *
 * All triage fields are rendered as plain text — no MarkdownText, no
 * dangerouslySetInnerHTML. XSS-safety mirror of MasterTaskCard's
 * domain-chip pattern from ADR-100.
 */

import type { TriageItem } from "../../lib/triageApi";
import { SeverityBadge, SourceBadge } from "./TriageBadgeUI";

interface TriageItemCardProps {
  item: TriageItem;
  onClick: () => void;
}

export function TriageItemCard({ item, onClick }: TriageItemCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left border border-stone-200 rounded-lg p-3 hover:bg-stone-50 transition-colors"
      data-testid={`triage-item-${item.id}`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <SourceBadge source={item.source} />
        <SeverityBadge severity={item.severity} />
        <span className="text-[11px] text-stone-500 font-mono">{item.id}</span>
        <span className="text-[11px] text-stone-500">
          → {item.suggestedPriority} / {item.suggestedDomain}
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
