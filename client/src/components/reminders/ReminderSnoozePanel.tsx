/*
 * ReminderSnoozePanel — "Snooze until [date] [Tomorrow] [Next week] [Snooze]"
 * (mockup page 02, operator decision on page 07: a date picker plus Tomorrow /
 * Next week). Tomorrow and Next week fill the date field; the Snooze button
 * confirms, so a click never snoozes by accident. A DAY only, no time. The
 * server and the reminder tool stay the authority on the date rule; the answer
 * text is shown as plain text. The same panel sits inline in the detail dialog
 * and inside the row's popover.
 */
import { useState } from "react";

import { minRevisitDate, snoozePresets } from "../../lib/triageSnooze";

const FIELD =
  "h-9 rounded-[var(--radius-button)] border-[1.5px] border-[var(--surface-form-line,#8e847e)] bg-white px-2 text-[13px] text-[var(--color-text)] pointer-coarse:min-h-[44px] pointer-coarse:text-[16px]";
const SECONDARY =
  "inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--surface-form-line,#8e847e)] bg-white px-3 text-[13px] font-semibold text-[var(--color-text)] hover:bg-[var(--surface-form-sunken-strong,#d9d3cc)] pointer-coarse:min-h-[44px]";

interface Props {
  pending: boolean;
  error: string | null;
  onSnooze: (day: string) => void;
  testIdBase: string;
}

export function ReminderSnoozePanel({ pending, error, onSnooze, testIdBase }: Props) {
  const presets = snoozePresets();
  const min = minRevisitDate();
  const [day, setDay] = useState(presets.tomorrow);

  return (
    <div className="flex flex-col gap-2" data-testid={`${testIdBase}-snooze-panel`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text)]">
        <b>Snooze until</b>
        <input
          type="date"
          min={min}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Snooze until (day)"
          data-testid={`${testIdBase}-snooze-date`}
          className={FIELD}
        />
        <button type="button" className={SECONDARY} onClick={() => setDay(presets.tomorrow)} data-testid={`${testIdBase}-snooze-tomorrow`}>
          Tomorrow
        </button>
        <button type="button" className={SECONDARY} onClick={() => setDay(presets.week)} data-testid={`${testIdBase}-snooze-week`}>
          Next week
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !day || day < min}
          onClick={() => onSnooze(day)}
          data-testid={`${testIdBase}-snooze-go`}
        >
          Snooze
        </button>
      </div>
      {error && (
        <div role="alert" className="text-xs text-[var(--color-error,#DC2626)] [overflow-wrap:anywhere]" data-testid={`${testIdBase}-snooze-error`}>
          {error}
        </div>
      )}
    </div>
  );
}
