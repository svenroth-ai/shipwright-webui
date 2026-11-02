import { useRef, type KeyboardEvent, type RefObject } from "react";

/** Phone tabs. The old "Detail" tab is gone: documents open in the Viewer, which lives under "Info". */
export type MissionCompactPanel = "overview" | "activity" | "info";

interface Props {
  active: MissionCompactPanel;
  onChange: (panel: MissionCompactPanel) => void;
  overviewRef: RefObject<HTMLButtonElement | null>;
  activityRef: RefObject<HTMLButtonElement | null>;
  infoRef?: RefObject<HTMLButtonElement | null>;
}

const TABS: { id: MissionCompactPanel; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "info", label: "Info" },
];

export function MissionCompactTabs({
  active,
  onChange,
  overviewRef,
  activityRef,
  infoRef,
}: Props) {
  const internalRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const refs = { overview: overviewRef, activity: activityRef, info: infoRef };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, TABS.findIndex((tab) => tab.id === active));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TABS.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    const next = TABS[nextIndex];
    onChange(next.id);
    internalRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Mission panels"
      data-testid="mission-compact-tabs"
      // `mc-tabs` reuses the SAME glass-pill trough as the desktop Mission /
      // Files & Terminal segmented switch (MissionSegmented) instead of a
      // second, flat-white hand-rolled skin — the two tab strips read as one
      // visual language now (iterate-2026-08-13-mission-mobile-visual). The
      // grid layout comes entirely from `.mc-tabs.compact-tab-surface` in
      // mission-record.css (an UNLAYERED plain-CSS rule, which always beats
      // Tailwind's `@layer utilities` regardless of specificity) — Tailwind
      // grid/gap/padding utilities are deliberately NOT duplicated here
      // (code review: they'd be dead weight, never actually applying).
      className="mc-tabs compact-tab-surface"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab, index) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              internalRefs.current[index] = element;
              if (refs[tab.id]) refs[tab.id]!.current = element;
            }}
            type="button"
            role="tab"
            id={`mission-compact-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`mission-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            data-testid={`mission-compact-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`mc-tab min-h-11 px-2 text-[13px]${selected ? " active" : ""}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
