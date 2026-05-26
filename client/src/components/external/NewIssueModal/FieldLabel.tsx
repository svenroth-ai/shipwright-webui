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

export function FieldLabel({ label, required, hint, children }: FieldLabelProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted,#6b7280)]">
        <span>{label}</span>
        {required && (
          <span className="text-[var(--color-error,#DC2626)]">*</span>
        )}
        {hint && (
          <span className="ml-auto text-[10px] font-medium normal-case tracking-normal opacity-80">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
