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
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
  info: "bg-stone-100 text-stone-600 border-stone-200",
};

const STATUS_CLASSES: Record<TriageStatus, string> = {
  triage: "bg-orange-100 text-orange-700 border-orange-200",
  promoted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-600 border-slate-200",
  snoozed: "bg-blue-100 text-blue-700 border-blue-200",
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
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200"
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
