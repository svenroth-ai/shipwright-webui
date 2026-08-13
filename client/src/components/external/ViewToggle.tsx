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
        "inline-flex h-8 items-center justify-center gap-1.5 text-[12px] font-medium transition-colors " +
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
