/*
 * PaneTabBar — compact (tablet/phone ≤1023px) tab switcher for the task-detail
 * panes (iterate-2026-06-14-tablet-responsive-view AC-4).
 *
 * ONE bar flattens the desktop 3-pane: Files · Terminal · Info · Viewer plus the
 * Expand control (mission-desktop-style-v2 V8). Info and Viewer are the two
 * segments of the SAME right pane, so there is no second tab level and no
 * "Preview" tab. (Transcript retired iterate-2026-08-13-mission-mobile-visual.)
 * The center subtree stays mounted. This is purely presentational — it owns no
 * pane content. TaskDetailThreePane keeps the SAME persistent `<PanelGroup>`
 * mounted and merely sizes the active pane to 100% / others to 0 on change,
 * so the embedded terminal subtree is never unmounted across a tab switch or
 * a breakpoint crossing (plan-review C1/C2; CLAUDE.md rule 21).
 */

import type { ReactNode } from "react";

export type PaneId = "left" | "center" | "right";

export type RightSegment = "info" | "viewer";

interface PaneTabBarProps {
  active: PaneId;
  /** Which segment of the right pane is showing (Info or Viewer). */
  segment?: RightSegment;
  onChange: (id: PaneId) => void;
  onSegmentChange?: (segment: RightSegment) => void;
  /** Trailing control (the Expand button). */
  children?: ReactNode;
}

// "right" keeps the Viewer tab's historical DOM id / testid (`pane-tab-right`).
type CompactTab = "left" | "terminal" | "info" | "right";

const TABS: { id: CompactTab; label: string }[] = [
  { id: "left", label: "Files" },
  { id: "terminal", label: "Terminal" },
  { id: "info", label: "Info" },
  { id: "right", label: "Viewer" },
];

const PANEL_FOR_TAB: Record<CompactTab, string> = {
  left: "task-pane-left",
  terminal: "task-center-panel-terminal",
  info: "task-pane-right",
  right: "task-pane-right",
};

export function PaneTabBar({ active, segment = "viewer", onChange, onSegmentChange, children }: PaneTabBarProps) {
  // "terminal" keeps its own DOM id/testid (unchanged from when it shared the
  // slot with Transcript) so the terminal/replay E2E corpus stays byte-stable.
  const selectedId: CompactTab =
    active === "center" ? "terminal" : active === "right" && segment === "info" ? "info" : active;
  const select = (id: CompactTab) => {
    if (id === "info" || id === "right") onSegmentChange?.(id === "info" ? "info" : "viewer");
    onChange(id === "terminal" ? "center" : id === "info" ? "right" : id);
  };

  return (
    <div
      data-testid="pane-tab-bar"
      className="pane-tab-bar compact-tab-surface grid shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[var(--g100)] p-1"
      style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))${children ? " auto" : ""}` }}
    >
      {/* The tablist holds ONLY the tabs; the trailing control is its sibling. */}
      <div
        role="tablist"
        aria-label="Task detail panes"
        className="contents"
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
      {children}
    </div>
  );
}
