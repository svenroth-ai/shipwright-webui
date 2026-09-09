/*
 * Board / List view toggle for the TaskBoard header.
 *
 * Iterate 3 remediation v2 — Surface 1 (2026-04-21). Mirrors mockup
 * `webui/designs/screens/kanban-with-projects.html` lines 192–216 (.view-toggle).
 *
 * State lives on the parent TaskBoardPage via a controlled `value` / `onChange`
 * pair — this component is stateless.
 *
 * Testids:
 *   view-toggle-root, view-toggle-board, view-toggle-list.
 *
 * Height fix (iterate-2026-08-13-mission-mobile-visual): the buttons carried
 * no explicit height (px-3 py-1 ⇒ ~28px) while the Filter/Density icon
 * buttons right next to them are a fixed 32px (h-8 w-8) — a real cross-
 * viewport mismatch, not a phone-only issue, now `h-8` everywhere. Phone
 * additionally drops the "Board"/"List" text labels (icon-only, same 32px
 * square as Filter/Density) to free up row width for the create button —
 * the accessible name moves to `aria-label` when the text is hidden.
 *
 * Touch-target audit (iterate-2026-09-09-phone-touch-targets-plus-cta):
 * `pointer-coarse:min-h-[44px]` bumps the HEIGHT to the AAA/HIG floor on a
 * touch device — the same idiom `SidebarNavItem`/the New-Issue modals use.
 * NOTE: `(pointer: coarse)` is width-independent, same as everywhere else
 * this idiom is used in the repo (`useIsCompactViewport.ts`'s own doc
 * comment says as much for the terminal key bar) — a touch-capable tablet
 * or touchscreen laptop at any width gets this height bump too, not just a
 * phone. That's intentional (a coarse pointer needs a real touch target
 * regardless of screen size); "phone" in this comment names the ROW-WIDTH
 * constraint below, not the gating condition. WIDTH deliberately stays 32px
 * at narrow widths: the Board toolbar row packs up to
 * 7 icon controls (ViewToggle ×2, Filter, 2 lead-tag buttons, Claim,
 * Density) plus the create button into 393px, and there is no free width
 * left to grow every one of them to 44px square without overflowing the
 * row — the same class of constraint that already justified the "+ New"
 * button's own 88px phone floor (buttons.css). 32px already clears WCAG
 * 2.5.8 AA (24×24); documented exemption from the stricter 44×44 AAA/HIG
 * square. `90b-phone-new-task-touch-safety.spec.ts` asserts the row does
 * not overflow at 393px with the taller buttons.
 */
import { LayoutGrid, List } from "lucide-react";

import { useIsPhoneViewport } from "../../hooks/useIsCompactViewport";

export type TaskBoardView = "board" | "list";

interface Props {
  value: TaskBoardView;
  onChange: (next: TaskBoardView) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  const iconOnly = useIsPhoneViewport();
  return (
    <div
      className={
        "inline-flex overflow-hidden rounded-[var(--radius-button)] " +
        "border-[1.5px] border-[var(--color-border)]"
      }
      data-testid="view-toggle-root"
      role="tablist"
      aria-label="Task view"
    >
      <ToggleButton
        active={value === "board"}
        onClick={() => onChange("board")}
        testId="view-toggle-board"
        icon={<LayoutGrid size={13} />}
        label="Board"
        iconOnly={iconOnly}
      />
      <div className="w-px self-stretch bg-[var(--color-border)]" aria-hidden="true" />
      <ToggleButton
        active={value === "list"}
        onClick={() => onChange("list")}
        testId="view-toggle-list"
        icon={<List size={13} />}
        label="List"
        iconOnly={iconOnly}
      />
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  testId: string;
  icon: React.ReactNode;
  label: string;
  iconOnly: boolean;
}

function ToggleButton({ active, onClick, testId, icon, label, iconOnly }: ToggleButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={onClick}
      data-testid={testId}
      className={
        "inline-flex h-8 items-center justify-center gap-1.5 pointer-coarse:min-h-[44px] text-[12px] font-medium transition-colors " +
        (iconOnly ? "w-8" : "px-3") + " " +
        (active
          ? "bg-[var(--color-muted-bg)] text-[var(--color-primary)]"
          : "bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text)]")
      }
    >
      {icon}
      {!iconOnly && label}
    </button>
  );
}
