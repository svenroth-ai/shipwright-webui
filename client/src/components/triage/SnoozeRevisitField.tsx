/*
 * SnoozeRevisitField.tsx — the optional "Revisit date" input for the Snooze
 * action (monorepo P2.03 parity, iterate-2026-08-05-triage-deferred-
 * envelope, AC7). Split out of TriageDetailModal.tsx (already
 * bloat-baselined at 375 lines) into its own file.
 *
 * Snooze-only — leaving it blank behaves exactly like today's plain Snooze
 * (the item parks with no date, "parked-not-due" forever). Client-side
 * validation is a courtesy only; the server is the source of truth
 * (400 invalid_revisitAt / 400 revisitAt_not_future).
 */

interface SnoozeRevisitFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SnoozeRevisitField({ value, onChange, disabled }: SnoozeRevisitFieldProps) {
  return (
    <label className="block mt-3">
      <span className="text-xs font-medium text-[var(--color-text)]">
        Revisit date (optional, only used by Snooze)
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full px-2 py-1.5 text-sm border border-[var(--color-border)] rounded disabled:opacity-50"
        data-testid="triage-snooze-revisit-date"
      />
      <span className="mt-1 block text-[11px] text-[var(--color-muted)]">
        Leave blank to park with no return date. Set a date and this item
        comes back to Open on its own.
      </span>
    </label>
  );
}
