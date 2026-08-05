import { useRef, type KeyboardEvent, type RefObject } from "react";

export type MissionCompactPanel = "overview" | "activity" | "detail";

interface Props {
  active: MissionCompactPanel;
  detailAvailable: boolean;
  onChange: (panel: MissionCompactPanel) => void;
  overviewRef: RefObject<HTMLButtonElement | null>;
  activityRef: RefObject<HTMLButtonElement | null>;
  detailRef: RefObject<HTMLButtonElement | null>;
}

const TABS: { id: MissionCompactPanel; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "detail", label: "Detail" },
];

export function MissionCompactTabs({
  active,
  detailAvailable,
  onChange,
  overviewRef,
  activityRef,
  detailRef,
}: Props) {
  const internalRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const refs = { overview: overviewRef, activity: activityRef, detail: detailRef };
  const enabled = TABS.filter((tab) => tab.id !== "detail" || detailAvailable);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, enabled.findIndex((tab) => tab.id === active));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabled.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    onChange(next.id);
    internalRefs.current[TABS.findIndex((tab) => tab.id === next.id)]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Mission panels"
      data-testid="mission-compact-tabs"
      className="compact-tab-surface grid shrink-0 grid-cols-3 gap-1 border-b border-[var(--line)] bg-[var(--g100)] p-1"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab, index) => {
        const selected = active === tab.id;
        const disabled = tab.id === "detail" && !detailAvailable;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              internalRefs.current[index] = element;
              refs[tab.id].current = element;
            }}
            type="button"
            role="tab"
            id={`mission-compact-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`mission-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            data-testid={`mission-compact-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={
              "min-h-11 rounded-[7px] px-2 text-[13px] font-semibold transition " +
              (selected
                ? "bg-white text-[var(--ink)] shadow-[inset_0_-3px_0_var(--accent)]"
                : "bg-white text-[var(--body)] hover:bg-[var(--g50)] disabled:text-[var(--faint)]")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
