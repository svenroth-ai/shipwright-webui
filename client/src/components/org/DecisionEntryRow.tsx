/*
 * DecisionEntryRow — one `decisions-proposed.md` entry row, split out of
 * `OrgDecisionsProposedModal.tsx` to stay under the 300-line convention.
 */
import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { DocumentMarkdown } from "../external/SmartViewer/DocumentMarkdown";

export type EntryStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; alreadyCountersigned: boolean; adr: string }
  | { kind: "duplicate"; count: number }
  | { kind: "resolved-elsewhere" }
  | { kind: "error"; message: string };

export function DecisionEntryRow({
  rowKey,
  entry,
  status,
  onCountersign,
}: {
  /** Caller's per-row identity key — includes the array index, so two
   *  entries sharing (timestamp, leadId) (409 duplicate_proposal_identity)
   *  still get independently addressable data-testids. Never derive a
   *  testid from `entry.timestamp`/`entry.leadId` alone in this component. */
  rowKey: string;
  entry: ProposedDecisionEntry;
  status: EntryStatus;
  onCountersign: () => void;
}) {
  const pending = status.kind === "pending";
  const settled = status.kind === "done";

  return (
    <li
      className="rounded-[8px] border border-[var(--color-border,#e0dbd4)] p-3 text-[12px]"
      data-testid={`org-decisions-proposed-entry-${rowKey}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-[var(--color-muted,#6b7280)]">
          {entry.timestamp} — {entry.leadId}
        </span>
        {!settled && (
          <button
            type="button"
            data-testid={`org-decisions-proposed-countersign-${rowKey}`}
            disabled={pending}
            onClick={onCountersign}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
          >
            {pending ? "Countersigning…" : "Countersign"}
          </button>
        )}
      </div>
      {entry.evidence && (
        <div className="mt-1 text-[11px]" style={{ color: "var(--color-muted, #6b7280)" }}>
          Evidence: {entry.evidence}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-relaxed">
        <DocumentMarkdown text={entry.body} />
      </div>

      {status.kind === "done" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-success, #15803d)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <CheckCircle2 size={12} aria-hidden="true" />
          {status.alreadyCountersigned
            ? `Already countersigned as ${status.adr}.`
            : `Countersigned as ${status.adr}.`}
        </div>
      )}
      {status.kind === "duplicate" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <AlertCircle size={12} aria-hidden="true" />
          Two proposals share this identity ({status.count}) — resolve by hand.
        </div>
      )}
      {status.kind === "resolved-elsewhere" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <CheckCircle2 size={12} aria-hidden="true" />
          Already resolved elsewhere.
        </div>
      )}
      {status.kind === "error" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <AlertCircle size={12} aria-hidden="true" />
          Couldn't countersign: {status.message}
        </div>
      )}
    </li>
  );
}
