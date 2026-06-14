/*
 * PaneTabBar — compact (tablet/phone ≤1023px) tab switcher for the task-detail
 * panes (iterate-2026-06-14-tablet-responsive-view AC-4).
 *
 * Three tabs map 1:1 onto the desktop 3-pane: Files (left) · Session (center,
 * which keeps its OWN inner Transcript/Terminal Radix tabs) · Viewer (right).
 * This is purely presentational — it owns no pane content. TaskDetailThreePane
 * keeps the SAME persistent `<PanelGroup>` mounted and merely sizes the active
 * pane to 100% / others to 0 on change, so the embedded terminal subtree is
 * never unmounted across a tab switch or a breakpoint crossing (plan-review
 * C1/C2; CLAUDE.md rule 21).
 */

export type PaneId = "left" | "center" | "right";

interface PaneTabBarProps {
  active: PaneId;
  onChange: (id: PaneId) => void;
}

const TABS: { id: PaneId; label: string }[] = [
  { id: "left", label: "Files" },
  { id: "center", label: "Session" },
  { id: "right", label: "Viewer" },
];

export function PaneTabBar({ active, onChange }: PaneTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Task detail panes"
      data-testid="pane-tab-bar"
      className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
    >
      {TABS.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`pane-tab-${t.id}`}
            onClick={() => onChange(t.id)}
            className={
              "rounded-[var(--radius-button)] px-3 py-1 text-[13px] font-medium transition-colors " +
              (selected
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-muted)] hover:bg-[var(--color-muted-bg)]")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
