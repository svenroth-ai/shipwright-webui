/*
 * MoreOptionsDisclosure — the collapsed-by-default "everything below the
 * Description" wrapper shared by every create-dialog body (New Task /
 * New Iterate / New Pipeline / custom-project generic).
 *
 * iterate-2026-07-06-collapse-dialog-more-options: the metadata fields,
 * schema parameters, and the Command preview used to render inline under
 * the Description, which cluttered the common "just make a task" flow.
 * They now live inside this gray-backgrounded disclosure so a user who
 * only wants Title + Description sees a single, obvious "More options" bar
 * they can ignore — while everything stays one click away.
 *
 * Presentational only. The open/closed flag is owned by the form state
 * (`moreOptionsOpen`) so it resets to collapsed on every modal open
 * (auto-expanding only when the modal is pre-seeded with advanced content
 * — see useNewIssueFormState). Required parameters render OUTSIDE this
 * disclosure (a hidden required field would disable Launch with no visible
 * cause), so this wrapper never traps the user.
 *
 * The `overflow-hidden` below rounds the corners over the header's hover
 * fill — but it also strips this element's flex automatic minimum size, so
 * a bounded column-flex parent may squeeze and clip it
 * (iterate-2026-07-14-more-options-flex-clip). ModalShell's body pins
 * `[&>*]:shrink-0` to prevent that — see the canonical explanation there.
 * Any other bounded flex parent hosting this component owes it the same.
 */

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export interface MoreOptionsDisclosureProps {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Header label. Defaults to "More options". */
  label?: string;
}

export function MoreOptionsDisclosure({
  open,
  onToggle,
  children,
  label = "More options",
}: MoreOptionsDisclosureProps) {
  return (
    <div
      data-testid="new-issue-more-options"
      className="overflow-hidden rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)]"
    >
      <button
        type="button"
        data-testid="new-issue-more-options-toggle"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-button,8px)] px-3 py-2.5 pointer-coarse:min-h-[44px] text-left text-[12px] font-semibold text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
      >
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span>{label}</span>
          {!open && (
            <span className="font-normal text-[var(--color-muted,#6b7280)]">
              options, parameters &amp; command preview
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`flex-shrink-0 text-[var(--color-muted,#6b7280)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div
          data-testid="new-issue-more-options-content"
          className="flex flex-col gap-4 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-3 py-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}
