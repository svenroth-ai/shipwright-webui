/*
 * TriageDetailHeader.tsx — title/badges/provenance + Edit/Close controls
 * for TriageDetailModal's header row. Split out of TriageDetailModal.tsx
 * (already bloat-baselined) for iterate-2026-08-08-triage-amend-reader
 * (AC8), same extraction-over-growth pattern as SnoozeRevisitField.tsx.
 *
 * Per the Design Notes, the "title/severity/detail block" toggles between
 * read display and TriageAmendForm's inline form — while `editMode` is true,
 * the visible title text and the SeverityBadge are hidden here, since the
 * form immediately below shows an editable title input and severity select
 * for the same two fields; showing both was a mixed read/edit dual-display
 * (external code-review finding, iterate-2026-08-08-triage-amend-reader).
 * `Dialog.Title` itself still renders (Radix requires it for the dialog's
 * accessible name) but visually hidden (`sr-only`) in that state. The
 * source/status/pending-delivery badges, id and provenance line are NOT
 * part of that block — they carry no editable counterpart in the form, so
 * they stay visible throughout.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, X } from "lucide-react";

import type { TriageItem } from "../../lib/triageApi";
import { PendingDeliveryBadge, SeverityBadge, SourceBadge, StatusBadge } from "./TriageBadgeUI";

interface TriageDetailHeaderProps {
  item: TriageItem;
  editMode: boolean;
  onEdit: () => void;
}

export function TriageDetailHeader({ item, editMode, onEdit }: TriageDetailHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <Dialog.Title className={editMode ? "sr-only" : "text-lg font-semibold"}>
          {item.title}
        </Dialog.Title>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <SourceBadge source={item.source} />
          {!editMode && <SeverityBadge severity={item.severity} />}
          <StatusBadge status={item.status} />
          {item.pendingDelivery && <PendingDeliveryBadge />}
          <code className="text-[11px] text-[var(--color-muted)]">{item.id}</code>
        </div>
        {item.amendedBy && (
          <div
            className="mt-1 text-[11px] text-[var(--color-muted)]"
            data-testid="triage-amend-provenance"
          >
            Last edited by {item.amendedBy} · {item.amendedAt}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {item.status === "triage" && !editMode && (
          <button
            type="button"
            onClick={onEdit}
            className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Edit"
            data-testid="triage-edit-toggle"
          >
            <Pencil size={16} />
          </button>
        )}
        <Dialog.Close asChild>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </Dialog.Close>
      </div>
    </div>
  );
}
