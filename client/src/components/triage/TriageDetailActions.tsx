/*
 * TriageDetailActions — the action row at the bottom of the detail dialog
 * (extracted from TriageDetailModal to keep it under the 300-line cap;
 * iterate-2026-11-08-triage-page-redesign). Fix now · Dismiss · Snooze ▾ ·
 * Promote. Snooze is the same portaled menu the cards use, so its date
 * picker can never overflow the dialog.
 */

import { Loader2 } from "lucide-react";

import { useSnoozePending } from "../../hooks/useSnoozePending";
import { TriageSnoozeMenu } from "./TriageSnoozeMenu";

interface Props {
  projectId: string;
  itemId: string;
  reason: string;
  /** A campaign CTA is shown above, so Fix now drops to the secondary style. */
  fixNowSecondary: boolean;
  fixNowLoading: boolean;
  dismissing: boolean;
  writeDisabled: boolean;
  writeDisabledReason: string;
  onFixNow: () => void;
  onDismiss: () => void;
  onPromote: () => void;
  onEdit: () => void;
  onSnoozed: () => void;
}

const BASE =
  "h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5";
const PRIMARY = `${BASE} bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-[0.98] disabled:cursor-not-allowed`;
const SECONDARY = `${BASE} border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-muted-bg)] hover:border-[var(--color-accent)]`;

export function TriageDetailActions({
  projectId,
  itemId,
  reason,
  fixNowSecondary,
  fixNowLoading,
  dismissing,
  writeDisabled,
  writeDisabledReason,
  onFixNow,
  onDismiss,
  onPromote,
  onEdit,
  onSnoozed,
}: Props) {
  const why = writeDisabled ? writeDisabledReason : undefined;
  const snoozing = useSnoozePending(projectId);
  return (
    <div className="flex flex-wrap justify-end gap-2.5 mt-4 items-center">
      <button
        type="button"
        onClick={onEdit}
        disabled={writeDisabled}
        title={why}
        className={`${SECONDARY} mr-auto`}
        data-testid="triage-edit-toggle"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onFixNow}
        disabled={fixNowLoading}
        className={fixNowSecondary ? SECONDARY : PRIMARY}
        data-testid="triage-fix-now"
      >
        {fixNowLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Fix now
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={writeDisabled || dismissing || snoozing}
        title={why}
        className={SECONDARY}
        data-testid="triage-dismiss"
      >
        {dismissing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Dismiss
      </button>
      <TriageSnoozeMenu
        projectId={projectId}
        itemId={itemId}
        reason={reason}
        disabled={writeDisabled || dismissing}
        disabledReason={writeDisabledReason}
        buttonClassName={SECONDARY}
        onSnoozed={onSnoozed}
      />
      <button
        type="button"
        onClick={onPromote}
        disabled={writeDisabled}
        title={why}
        className={PRIMARY}
        data-testid="triage-promote"
      >
        Promote
      </button>
    </div>
  );
}
