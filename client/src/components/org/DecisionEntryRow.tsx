/*
 * DecisionEntryRow — one `decisions-proposed.md` entry row, split out of
 * `OrgDecisionsProposedModal.tsx` to stay under the 300-line convention.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ProposedDecisionEntry } from "../../lib/orgDecisionsApi";
import { buildEntryView } from "../../lib/orgProposedView";
import { blockDigest } from "../../lib/orgBlockDigest";
import { duplicateMessage } from "./decisionMessages";
import { DecisionEntryDetail } from "./DecisionEntryDetail";
import { DecisionLineEditor } from "./DecisionLineEditor";
import { DecisionRejectControl } from "./DecisionRejectControl";

export type EntryStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; alreadyCountersigned: boolean; adr: string; edited?: boolean; loggedLineDiffers?: boolean }
  | { kind: "rejected"; alreadyRejected: boolean }
  | { kind: "blocked"; message: string }
  | { kind: "duplicate"; count: number; loggedAdr?: string }
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
  /** `line` is the line the operator SAW (edited or not), so only seen text is logged; absent for an entry without a line. */
  onCountersign: (line?: string) => void;
  onReject: (reason: string) => void;
  /** The lead proposed a decision key the operator already rejected. */
  isRepeat: boolean;
}) {
  const pending = status.kind === "pending";
  const settled = status.kind === "done";
  const original = buildEntryView(entry.block, entry.evidence).proposedLine;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original ?? "");
  // The version the operator opened (or last confirmed reading). A refetch that puts a rewritten proposal under this
  // row makes `changed` true in the SAME render, so no click can reach the new content under the old view.
  const digest = useMemo(() => blockDigest(entry.block), [entry.block]);
  const [seenDigest, setSeenDigest] = useState(digest);
  const changed = !settled && digest !== seenDigest;
  const [editDiscarded, setEditDiscarded] = useState(false);
  const hasLine = original !== null && !settled;
  const canEdit = hasLine && !changed; // an empty line is editable too: the server asks for one
  const prev = useRef({ digest, original });
  // A different proposal under this instance: the edit field starts over from the NEW proposed line; an edit the
  // operator had open is flagged, never carried over silently.
  useEffect(() => {
    if (prev.current.digest === digest) return; // keyed on the digest, like `changed`: a CRLF-only difference is no change
    setEditDiscarded((was) => was || editing); // an open edit field is flagged (sticky until acknowledged), changed or not
    prev.current = { digest, original };
    setDraft(original ?? "");
  }, [digest]); // eslint-disable-line react-hooks/exhaustive-deps
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
            disabled={pending || changed}
            aria-label={`${pending ? "Countersigning" : "Countersign"} proposal from ${entry.leadId} at ${entry.timestamp}`}
            onClick={() => onCountersign(original === null ? undefined : editing ? draft : original)}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
          >
            {pending ? "Countersigning…" : "Countersign"}
          </button>
        )}
        {hasLine && (
          <button
            type="button"
            data-testid={`org-decisions-proposed-edit-${rowKey}`}
            disabled={pending || changed}
            aria-pressed={editing}
            aria-label={`Edit line of the proposal from ${entry.leadId} at ${entry.timestamp}`}
            onClick={() => setEditing((on) => !on)}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50"
          >
            Edit line
          </button>
        )}
        {!settled && <DecisionRejectControl rowKey={rowKey} pending={pending} locked={changed} onReject={onReject} />}
      </div>
      {editDiscarded && !changed && (
        <div role="status" className="mt-2 text-[11px]" data-testid={`org-decisions-proposed-edit-replaced-${rowKey}`}>
          Your open edit was replaced by the proposed line of the current version.
        </div>
      )}
      {changed && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center gap-2 rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)] px-2 py-1.5 text-[11px]"
          data-testid={`org-decisions-proposed-changed-${rowKey}`}
        >
          <AlertCircle size={12} aria-hidden="true" />
          <span>
            This proposal changed since you opened it — reload. Read the new version below before deciding.
            {editDiscarded ? " Your open edit was replaced by the new proposed line." : ""}
          </span>
          <button
            type="button"
            data-testid={`org-decisions-proposed-changed-ack-${rowKey}`}
            onClick={() => {
              setSeenDigest(digest);
              setEditDiscarded(false);
            }}
            className="rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-0.5 hover:bg-[var(--color-surface,#ffffff)]"
          >
            I have read the new version
          </button>
        </div>
      )}
      <DecisionEntryDetail
        rowKey={rowKey}
        entry={entry}
        labelId={labelId}
        lineSlot={canEdit && editing ? <DecisionLineEditor rowKey={rowKey} value={draft} original={original ?? ""} disabled={pending} onChange={(v) => { setDraft(v); setEditDiscarded(false); }} /> : undefined}
      />

      {status.kind === "done" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-success, #15803d)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
          role="status"
        >
          <CheckCircle2 size={12} aria-hidden="true" />
          {status.alreadyCountersigned
            ? `Already countersigned as ${status.adr}${status.loggedLineDiffers ? " with an earlier wording" : ""}.`
            : `Countersigned as ${status.adr}${status.edited ? " with your edited line" : ""}.`}
        </div>
      )}
      {status.kind === "blocked" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
          role="alert"
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
          role="alert"
        >
          <AlertCircle size={12} aria-hidden="true" />
          {duplicateMessage(status.count, status.loggedAdr)}
        </div>
      )}
      {status.kind === "resolved-elsewhere" && (
        <div
          className="mt-2 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--color-muted, #6b7280)" }}
          data-testid={`org-decisions-proposed-result-${rowKey}`}
          role="status"
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
          role="alert"
        >
          <AlertCircle size={12} aria-hidden="true" />
          Couldn't complete: {status.message}
        </div>
      )}
    </li>
  );
}
