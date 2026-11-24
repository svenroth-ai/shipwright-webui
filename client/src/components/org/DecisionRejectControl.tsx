/*
 * DecisionRejectControl — the Reject action of a proposed entry and its
 * confirmation step (campaign shadow-proposals-webui, W3). Reject removes
 * the entry and leaves an audit record, so it asks first; the confirm
 * button is disabled while the request is in flight (double click = one).
 */
import { useState } from "react";

const BTN =
  "rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px] hover:bg-[var(--color-muted-bg,#ede8e1)] disabled:opacity-50";

export function DecisionRejectControl({
  rowKey,
  pending,
  locked = false,
  onReject,
}: {
  rowKey: string;
  /** An action on this row is running. */
  pending: boolean;
  /** The row changed under the operator and was not acknowledged yet: no decision can be started. */
  locked?: boolean;
  onReject: (reason: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (!confirming) {
    return (
      <button
        type="button"
        data-testid={`org-decisions-proposed-reject-${rowKey}`}
        disabled={pending || locked}
        onClick={() => setConfirming(true)}
        className={BTN}
      >
        Reject
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label="Confirm reject"
      className="flex w-full flex-col gap-1.5"
      data-testid={`org-decisions-proposed-reject-confirm-${rowKey}`}
    >
      <label className="text-[11px]" style={{ color: "var(--color-muted, #6b7280)" }}>
        Why reject? (optional, kept in the audit log - do not paste quotes)
        <input
          type="text"
          maxLength={280}
          value={reason}
          disabled={pending || locked}
          onChange={(e) => setReason(e.target.value)}
          data-testid={`org-decisions-proposed-reject-reason-${rowKey}`}
          className="mt-0.5 block w-full rounded-[6px] border border-[var(--color-border,#e0dbd4)] px-2 py-1 text-[11px]"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid={`org-decisions-proposed-reject-confirm-btn-${rowKey}`}
          disabled={pending || locked}
          onClick={() => onReject(reason)}
          className={BTN}
        >
          {pending ? "Rejecting…" : "Confirm reject"}
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={BTN}>
          Cancel
        </button>
      </div>
    </div>
  );
}
