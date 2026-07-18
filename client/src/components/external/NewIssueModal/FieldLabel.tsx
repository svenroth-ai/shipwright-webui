/*
 * Tiny label wrapper used by every body inside the modal. Extracted from
 * NewIssueModal.tsx (lines 1370-1395). Pure presentational; no state.
 */

import type { ReactNode } from "react";

interface FieldLabelProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}

/*
 * Sven 2026-07-17: the label + hint were --color-muted (#79716B), which is only
 * ~4.0:1 on the form sheet — under the WCAG AA 4.5:1 floor for small text, and
 * exactly the "helper texts are too light" report. --body (#44403C) is ~8.9:1.
 * The hint keeps its hierarchy through SIZE/WEIGHT, not through a lighter colour
 * (the old `opacity-80` made it lighter still, so it is gone).
 */
export function FieldLabel({ label, required, hint, children }: FieldLabelProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--body,#44403c)]">
        <span>{label}</span>
        {required && (
          <span className="text-[var(--color-error,#DC2626)]">*</span>
        )}
        {hint && (
          <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-[var(--body,#44403c)]">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
