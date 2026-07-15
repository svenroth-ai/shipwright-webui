/*
 * TriageBadgeUI.tsx — small severity / source / status pill primitives,
 * used by TriageItemCard + TriageDetailModal.
 *
 * Severity colors mirror MasterTaskCard's priority badges (lead-foundation,
 * ADR-100) for consistency: red/orange/yellow/slate/stone palette.
 *
 * Plain-text rendering only (no MarkdownText, no dangerouslySetInnerHTML)
 * — addresses the OpenAI MED #7 XSS concern from the iterate spec
 * external review.
 */

import type {
  TriageSeverity,
  TriageStatus,
} from "../../lib/triageApi";

const SEVERITY_CLASSES: Record<TriageSeverity, string> = {
  critical: "bg-err-tint text-err border-[var(--err-line)]",
  high: "bg-warn-tint text-warn border-[var(--warn-line)]",
  medium: "bg-warn-tint text-warn border-[var(--warn-line)]",
  low: "bg-inset text-body border-line-strong",
  info: "bg-inset text-body border-line",
};

const STATUS_CLASSES: Record<TriageStatus, string> = {
  triage: "bg-warn-tint text-warn border-[var(--warn-line)]",
  promoted: "bg-ok-tint text-ok border-[var(--ok-line)]",
  dismissed: "bg-inset text-body border-line-strong",
  snoozed: "bg-info-tint text-info border-[var(--info-line)]",
};

export function SeverityBadge({ severity }: { severity: TriageSeverity }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${SEVERITY_CLASSES[severity]}`}
      data-testid={`triage-severity-${severity}`}
    >
      {severity}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-inset text-body border border-line"
      data-testid={`triage-source-${source}`}
    >
      {source}
    </span>
  );
}

export function StatusBadge({ status }: { status: TriageStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${STATUS_CLASSES[status]}`}
    >
      {status}
    </span>
  );
}

/**
 * Outbox-residence badge (iterate-2026-06-10-triage-pending-delivery-badge):
 * the item's append lives only in the gitignored per-tree outbox buffer —
 * visible live, but not yet durable in the tracked triage.jsonl. The next
 * iterate's setup sweep delivers it into that iterate's PR. The precise
 * tooltip is intentional: the Command Center audience is the repo operator.
 */
export function PendingDeliveryBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-warn-tint text-warn border border-[var(--warn-line)]"
      title="Not yet in the tracked triage log — ships with the next iterate PR (setup sweep delivers it automatically)"
      data-testid="triage-pending-delivery"
    >
      pending delivery
    </span>
  );
}
