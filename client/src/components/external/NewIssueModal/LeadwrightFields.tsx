/*
 * 2-column grid of the 5 leadwright-routing inputs.
 *
 * Rendering is opt-in per action via `modal_fields` (see useNewIssueFormDerived
 * — the `showLead*` flags). When all five are off this returns null so the
 * body component's JSX stays clean.
 *
 * The submit hook splits Tags + BlockedBy on commas / trims / filters
 * empties before forwarding to the create POST body.
 */

import type { Dispatch, SetStateAction } from "react";

import { FieldLabel } from "./FieldLabel";

export interface LeadwrightFieldsProps {
  showLeadDomain: boolean;
  showLeadPriority: boolean;
  showLeadComplexityHint: boolean;
  showLeadTags: boolean;
  showLeadBlockedBy: boolean;
  leadDomain: string;
  setLeadDomain: Dispatch<SetStateAction<string>>;
  leadPriority: "" | "P0" | "P1" | "P2" | "P3";
  setLeadPriority: Dispatch<SetStateAction<"" | "P0" | "P1" | "P2" | "P3">>;
  leadComplexityHint: "" | "small" | "medium" | "large";
  setLeadComplexityHint: Dispatch<
    SetStateAction<"" | "small" | "medium" | "large">
  >;
  leadTagsRaw: string;
  setLeadTagsRaw: Dispatch<SetStateAction<string>>;
  leadBlockedByRaw: string;
  setLeadBlockedByRaw: Dispatch<SetStateAction<string>>;
}

export function LeadwrightFieldsFragment(props: LeadwrightFieldsProps) {
  const {
    showLeadDomain,
    showLeadPriority,
    showLeadComplexityHint,
    showLeadTags,
    showLeadBlockedBy,
  } = props;
  if (
    !showLeadDomain &&
    !showLeadPriority &&
    !showLeadComplexityHint &&
    !showLeadTags &&
    !showLeadBlockedBy
  )
    return null;
  return (
    <div data-testid="new-issue-lead-fields" className="grid grid-cols-2 gap-3">
      {showLeadDomain && (
        <FieldLabel label="Domain" hint="optional — routing key">
          <input
            type="text"
            value={props.leadDomain}
            onChange={(e) => props.setLeadDomain(e.target.value)}
            data-testid="new-issue-domain-input"
            placeholder="e.g. shipwright"
            className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
          />
        </FieldLabel>
      )}
      {showLeadPriority && (
        <FieldLabel label="Priority" hint="optional">
          <select
            value={props.leadPriority}
            onChange={(e) =>
              props.setLeadPriority(e.target.value as typeof props.leadPriority)
            }
            data-testid="new-issue-priority-select"
            className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
          >
            <option value="">— unset —</option>
            <option value="P0">P0 (critical)</option>
            <option value="P1">P1 (high)</option>
            <option value="P2">P2 (medium)</option>
            <option value="P3">P3 (low)</option>
          </select>
        </FieldLabel>
      )}
      {showLeadComplexityHint && (
        <FieldLabel label="Complexity hint" hint="optional">
          <select
            value={props.leadComplexityHint}
            onChange={(e) =>
              props.setLeadComplexityHint(
                e.target.value as typeof props.leadComplexityHint,
              )
            }
            data-testid="new-issue-complexity-hint-select"
            className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
          >
            <option value="">— unset —</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
          </select>
        </FieldLabel>
      )}
      {showLeadTags && (
        <FieldLabel label="Tags" hint="optional — comma-separated">
          <input
            type="text"
            value={props.leadTagsRaw}
            onChange={(e) => props.setLeadTagsRaw(e.target.value)}
            data-testid="new-issue-tags-input"
            placeholder="auth, billing"
            className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
          />
        </FieldLabel>
      )}
      {showLeadBlockedBy && (
        <FieldLabel
          label="Blocked by"
          hint="optional — taskIds, comma-separated"
        >
          <input
            type="text"
            value={props.leadBlockedByRaw}
            onChange={(e) => props.setLeadBlockedByRaw(e.target.value)}
            data-testid="new-issue-blocked-by-input"
            placeholder="task-x, task-y"
            className="w-full rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary,#6b5e56)]"
          />
        </FieldLabel>
      )}
    </div>
  );
}
