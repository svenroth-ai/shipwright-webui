/*
 * TriageSnoozeMenu — "Snooze ▾" on a card and in the detail dialog
 * (iterate-2026-11-08-triage-page-redesign). One popover: presets
 * (tomorrow, 1 week, 1 month, no date) and a date picker with a Snooze
 * button. Portaled, so it can never be clipped by the card or the dialog.
 * The reason is optional (the dialog passes its Reason field through).
 * The server stays the source of truth for the date rule; its message is
 * shown inline.
 */

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Loader2 } from "lucide-react";

import { useSnoozeTriageItem } from "../../hooks/useTriage";
import { minRevisitDate, snoozePresets } from "../../lib/triageSnooze";
import { MENU_CONTENT, MENU_ITEM, MENU_LABEL } from "./triageMenuStyles";

interface Props {
  projectId: string;
  itemId: string;
  /** Optional reason (the dialog's Reason field). */
  reason?: string;
  disabled?: boolean;
  disabledReason?: string;
  buttonClassName: string;
  onSnoozed?: () => void;
}

export function TriageSnoozeMenu({
  projectId,
  itemId,
  reason,
  disabled,
  disabledReason,
  buttonClassName,
  onSnoozed,
}: Props) {
  const snooze = useSnoozeTriageItem(projectId);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const presets = snoozePresets();
  const min = minRevisitDate();

  const run = async (revisitAt: string | undefined) => {
    setError(null);
    try {
      const result = await snooze.mutateAsync({
        triageId: itemId,
        reason: reason?.trim() || null,
        revisitAt,
      });
      if (!result.ok) {
        const body = result.body as { error?: string; message?: string };
        setError(body.message || `Snooze failed (${result.status}): ${body.error}`);
        return;
      }
      setOpen(false);
      onSnoozed?.();
    } catch (err) {
      setError(`Snooze failed — could not reach the server. ${String(err).slice(0, 120)}`);
    }
  };

  const preset = (label: string, value: string | undefined, testId: string) => (
    <button
      type="button"
      disabled={snooze.isPending}
      onClick={() => void run(value)}
      data-testid={testId}
      className={`${MENU_ITEM} w-full text-left disabled:opacity-50`}
    >
      <span className="flex-1">{label}</span>
      {value && <span className="font-mono text-[10px] text-[var(--color-muted)]">{value}</span>}
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled || snooze.isPending}
          title={disabled ? disabledReason : undefined}
          aria-haspopup="dialog"
          onClick={(e) => e.stopPropagation()}
          data-testid={`triage-snooze-menu-${itemId}`}
          className={buttonClassName}
        >
          {snooze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Snooze
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onClick={(e) => e.stopPropagation()}
          data-testid="triage-snooze-popover"
          className={`${MENU_CONTENT} z-[70] w-[230px] p-1.5`}
        >
          <div className={MENU_LABEL}>Snooze until</div>
          {preset("Tomorrow", presets.tomorrow, "triage-snooze-tomorrow")}
          {preset("In 1 week", presets.week, "triage-snooze-week")}
          {preset("In 1 month", presets.month, "triage-snooze-month")}
          {preset("No date", undefined, "triage-snooze-nodate")}
          <div className="mt-1 grid gap-1.5 border-t border-[var(--color-border)] px-1 pt-2">
            <label className="grid gap-1 text-xs font-medium text-[var(--color-text)]">
              Pick a date
              <input
                type="date"
                min={min}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="triage-snooze-date"
                className="h-8 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={!date || date < min || snooze.isPending}
              onClick={() => void run(date)}
              data-testid="triage-snooze-date-go"
              className="h-8 rounded-[var(--radius-button)] border-[1.5px] border-[var(--color-border)] text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-primary)] disabled:opacity-50"
            >
              Snooze until this date
            </button>
          </div>
          {error && (
            <div
              className="mt-2 rounded border border-[var(--err-line)] bg-err-tint p-2 text-xs text-err"
              data-testid="triage-snooze-error"
            >
              {error}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
