/*
 * DecisionEntryRow — one `decisions-proposed.md` entry row, split out of
 * `OrgDecisionsProposedModal.tsx` to stay under the 300-line convention.
 */
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { buildEntryView } from "../../lib/orgProposedView";
import { DecisionEntryDetail } from "./DecisionEntryDetail";
import { DecisionLineEditor } from "./DecisionLineEditor";
import { DecisionRejectControl } from "./DecisionRejectControl";

export type EntryStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; alreadyCountersigned: boolean; adr: string; edited?: boolean }
  | { kind: "rejected"; alreadyRejected: boolean }
  | { kind: "blocked"; message: string }
  | { kind: "duplicate"; count: number }
  | { kind: "resolved-elsewhere" }
  | { kind: "error"; message: string };

export function DecisionEntryRow({
  rowKey,
  entry,
  status,
  onCountersign,
  onReject,
  isRepeat,
}: {
  /** Caller's per-row identity key — includes the array index, so two
   *  entries sharing (timestamp, leadId) (409 duplicate_proposal_identity)
   *  still get independently addressable data-testids. Never derive a
   *  testid from `entry.timestamp`/`entry.leadId` alone in this component. */
  rowKey: string;
  entry: ProposedDecisionEntry;
  status: EntryStatus;
  /** `line` is the operator's edited proposed line; absent = approve as proposed. */
  onCountersign: (line?: string) => void;
  onReject: (reason: string) => void;
  /** The lead proposed a decision key the operator already rejected. */
  isRepeat: boolean;
}) {
  const pending = status.kind === "pending";
  const settled = status.kind === "done";
  const original = buildEntryView(entry.block, entry.evidence).proposedLine;
  const canEdit = original !== null && !settled; // an empty line is editable too: the server asks for one
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original ?? "");
  // The row key is positional: when a refetch puts a different proposal under this instance, drop the old draft.
  useEffect(() => {
    setEditing(false);
    setDraft(original ?? "");
  }, [entry.block]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelId = `org-proposed-label-${rowKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  return (
    <li
      className="rounded-[8px] border border-[var(--color-border,#e0dbd4)] p-3 text-[12px]"
      data-testid={`org-decisions-proposed-entry-${rowKey}`}
      aria-labelledby={labelId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="font-mono text-[11px] text-[var(--color-muted,#6b7280)]">
          <span className="sr-only">Proposal from </span>
          {entry.timestamp} — {entry.leadId}
        </span>
        {isRepeat && !settled && (
          <span
            className="rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)] px-1.5 py-0.5 text-[11px]"
            data-testid={`org-decisions-proposed-repeat-${rowKey}`}
          >
            Repeat of a rejected proposal
          </span>
        )}
        {!settled && (
          <button
            type="button"
            data-testid={`org-decisions-proposed-countersign-${rowKey}`}
            disabled={pending}
            aria-label={`${pending ? "Countersigning" : "Countersign"} proposal from ${entry.leadId} at ${entry.timestamp}`}
            onClick={() => onCountersign(editing ? draft : undefined)}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
          >
            {pending ? "Countersigning…" : "Countersign"}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            data-testid={`org-decisions-proposed-edit-${rowKey}`}
            disabled={pending}
            aria-pressed={editing}
            aria-label={`${editing ? "Stop editing" : "Edit"} the line of the proposal from ${entry.leadId} at ${entry.timestamp}`}
            onClick={() => setEditing((on) => !on)}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
          >
            {editing ? "Stop editing" : "Edit line"}
          </button>
        )}
        {!settled && <DecisionRejectControl rowKey={rowKey} pending={pending} onReject={onReject} />}
      </div>
      <DecisionEntryDetail
        rowKey={rowKey}
        entry={entry}
        labelId={labelId}
        lineSlot={canEdit && editing ? <DecisionLineEditor rowKey={rowKey} value={draft} original={original ?? ""} disabled={pending} onChange={setDraft} /> : undefined}
      />

      {status.kind === "done" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-success, #15803d)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <CheckCircle2 size={12} aria-hidden="true" />
          {status.alreadyCountersigned
            ? `Already countersigned as ${status.adr}.`
            : `Countersigned as ${status.adr}${status.edited ? " with your edited line" : ""}.`}
        </div>
      )}
      {status.kind === "blocked" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
        >
          <AlertCircle size={12} aria-hidden="true" />
          {status.message}
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
          Couldn't complete: {status.message}
        </div>
      )}
    </li>
  );
}
