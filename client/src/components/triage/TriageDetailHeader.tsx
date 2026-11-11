/*
 * TriageDetailHeader.tsx — title + the same pill row the card shows + Close
 * (iterate-2026-11-09-triage-polish-r3: Edit moved to the action row at the
 * bottom, pills now come from the shared TriagePills).
 *
 * While `editMode` is true the visible title and the severity pill are hidden
 * (the form below has an editable title and severity); `Dialog.Title` still
 * renders, visually hidden, as Radix requires it for the accessible name.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import type { TriageItem } from "../../lib/triageApi";
import { StatusBadge } from "./TriageBadgeUI";
import { TriagePills } from "./TriagePills";

interface TriageDetailHeaderProps {
  item: TriageItem;
  projectId: string;
  projectLabel?: string;
  editMode: boolean;
}

export function TriageDetailHeader({ item, projectId, projectLabel, editMode }: TriageDetailHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--surface-form-divider,#c3b8ae)] pb-4">
      <div className="min-w-0">
        <Dialog.Title className={editMode ? "sr-only" : "text-lg font-semibold leading-snug text-[var(--color-text)]"}>
          {item.title}
        </Dialog.Title>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <TriagePills item={item} projectId={projectId} projectLabel={projectLabel} hideSeverity={editMode} />
          {item.status !== "triage" && <StatusBadge status={item.status} />}
          <code className="text-xs text-[var(--body,#44403c)]">{item.id}</code>
        </div>
        {item.amendedBy && (
          <div className="mt-1 text-xs text-[var(--body,#44403c)]" data-testid="triage-amend-provenance">
            Last edited by {item.amendedBy} · {item.amendedAt}
          </div>
        )}
      </div>
      <Dialog.Close asChild>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--body,#44403c)] transition-colors hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] hover:text-[var(--ink,#1c1917)]"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </Dialog.Close>
    </div>
  );
}
