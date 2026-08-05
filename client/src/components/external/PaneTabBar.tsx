/*
 * PaneTabBar — compact (tablet/phone ≤1023px) tab switcher for the task-detail
 * panes (iterate-2026-06-14-tablet-responsive-view AC-4).
 *
 * Four compact tabs flatten the desktop 3-pane plus the center sub-view:
 * Files · Transcript · Terminal · Viewer. The center subtree stays mounted.
 * This is purely presentational — it owns no pane content. TaskDetailThreePane
 * keeps the SAME persistent `<PanelGroup>` mounted and merely sizes the active
 * pane to 100% / others to 0 on change, so the embedded terminal subtree is
 * never unmounted across a tab switch or a breakpoint crossing (plan-review
 * C1/C2; CLAUDE.md rule 21).
 */

export type PaneId = "left" | "center" | "right";

interface PaneTabBarProps {
  active: PaneId;
  centerTab: "transcript" | "terminal";
  onChange: (id: PaneId) => void;
  onCenterTabChange: (tab: "transcript" | "terminal") => void;
}

type CompactTab = "left" | "transcript" | "terminal" | "right";

const TABS: { id: CompactTab; label: string }[] = [
  { id: "left", label: "Files" },
  { id: "transcript", label: "Transcript" },
  { id: "terminal", label: "Terminal" },
  { id: "right", label: "Viewer" },
];

const PANEL_FOR_TAB: Record<CompactTab, string> = {
  left: "task-pane-left",
  transcript: "task-center-panel-transcript",
  terminal: "task-center-panel-terminal",
  right: "task-pane-right",
};

export function PaneTabBar({
  active,
  centerTab,
  onChange,
  onCenterTabChange,
}: PaneTabBarProps) {
  const selectedId: CompactTab = active === "center" ? centerTab : active;
  const select = (id: CompactTab) => {
    if (id === "transcript" || id === "terminal") {
      onCenterTabChange(id);
      onChange("center");
      return;
    }
    onChange(id);
  };

  return (
    <div
      role="tablist"
      aria-label="Task detail panes"
      data-testid="pane-tab-bar"
      className="compact-tab-surface grid shrink-0 grid-cols-4 gap-1 border-b border-[var(--line)] bg-[var(--g100)] p-1"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const current = TABS.findIndex((tab) => tab.id === selectedId);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
            ? TABS.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
        const button = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next];
        button?.focus();
        select(TABS[next].id);
      }}
    >
      {TABS.map((t) => {
        const selected = selectedId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`workspace-tab-${t.id}`}
            aria-controls={PANEL_FOR_TAB[t.id]}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`pane-tab-${t.id}`}
            onClick={() => select(t.id)}
            className={
              "min-h-11 min-w-0 truncate rounded-[7px] px-1.5 text-[12px] font-semibold transition-colors sm:text-[13px] " +
              (selected
                ? "bg-white text-[var(--ink)] shadow-[inset_0_-3px_0_var(--accent)]"
                : "bg-white text-[var(--body)] hover:bg-[var(--g50)]")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
