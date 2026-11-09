/*
 * TriageDismissPopover — the small "why?" popup behind a card's Dismiss
 * cross and its Resolve button (iterate-2026-11-09-triage-fixnow-task).
 * Nothing happens until the operator confirms; the reason is optional and
 * is stored exactly like the detail dialog's Reason field. Portaled, so it
 * can never be clipped by the card or the dialog.
 */

import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2 } from "lucide-react";

const MAX_REASON = 500;

interface Props {
  itemId: string;
  /** Verb on the confirm button and the popup title. */
  label: "Dismiss" | "Resolve";
  /** Reason prefilled when the popup opens (e.g. the finished task). */
  defaultReason?: string;
  pending: boolean;
  /** The element that opens the popup (receives the click). */
  trigger: ReactNode;
  /** Resolves true when the item was dismissed, so the popup can close. */
  onConfirm: (reason: string | null) => Promise<boolean>;
}

export function TriageDismissPopover({ itemId, label, defaultReason = "", pending, trigger, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(defaultReason);

  const confirm = async () => {
    const ok = await onConfirm(reason.trim() || null);
    if (ok) setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setReason(defaultReason);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`${label} this item`}
          data-testid={`triage-dismiss-popover-${itemId}`}
          className="z-[70] grid w-[min(280px,calc(100vw-16px))] gap-2.5 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]"
        >
          <label className="grid gap-1 text-xs font-medium text-[var(--color-text)]">
            {label} — reason (optional)
            <input
              type="text"
              value={reason}
              maxLength={MAX_REASON}
              autoFocus
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) void confirm();
              }}
              placeholder="out of scope this sprint"
              data-testid={`triage-dismiss-reason-${itemId}`}
              className="h-8 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm font-normal"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              data-testid={`triage-dismiss-cancel-${itemId}`}
              className="h-8 rounded-[var(--radius-button)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-muted-bg)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={pending}
              data-testid={`triage-dismiss-confirm-${itemId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {label}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
