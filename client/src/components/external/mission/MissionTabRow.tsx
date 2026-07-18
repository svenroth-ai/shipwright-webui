/*
 * MissionTabRow — the `.mc-tabrow` of Mission Control (A13, FR-01.57).
 *
 * Left: the segmented Mission | Files & Terminal switch (MissionSegmented). It
 * REPLACES the plain-button switch A11 inlined in TaskDetailPage; the testids
 * (`mission-tab-mission` / `mission-tab-files`) are preserved verbatim so every
 * A11/A12/visual spec keeps resolving. Right: a secondary glass "Open Ship's Log"
 * button. The Ship's Log surface is A15/A16; until it lands the button routes to
 * the existing projects page — never a dead button (AC4).
 *
 * Files & Terminal stays the mount-default view (A11); the Mission tab is opt-in.
 * Flipping the default would break the ~50 terminal/replay specs + the CI smoke
 * gate + auto-launch, so this iterate keeps the default and does NOT re-point it.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

import { MissionSegmented, type SegmentOption } from "./MissionSegmented";
import { useMissionContext } from "../../../hooks/useMissionContext";

export type MissionTab = "mission" | "files";

/** Until A15/A16 build the Ship's Log, its link resolves to the projects surface. */
export const SHIPS_LOG_ROUTE = "/projects";

const TABS: SegmentOption<MissionTab>[] = [
  { value: "mission", label: "Mission", testId: "mission-tab-mission" },
  { value: "files", label: "Files & Terminal", testId: "mission-tab-files" },
];

interface Props {
  value: MissionTab;
  onChange: (value: MissionTab) => void;
  /**
   * S1 (AC4) — used to ask the resolver whether this project should have a
   * Mission tab at all. A VALIDATED custom-actions project gets only Files &
   * Terminal. Optional so existing callers/tests render unchanged.
   */
  taskId?: string | null;
}

export function MissionTabRow({ value, onChange, taskId }: Props) {
  const context = useMissionContext(taskId);

  // Hide ONLY on an explicit `false` from the resolver: while the query is
  // loading, or if it fails, the tab stays — hiding a useful tab on an unknown
  // or ambiguous answer is the worse failure (CONTRACT §4, Review-2 GPT #12).
  const hideMission = context.data?.missionTabVisible === false;

  // If the tab is hidden while it happens to be the active view, fall back to
  // Files & Terminal rather than rendering an empty pane.
  useEffect(() => {
    if (hideMission && value === "mission") onChange("files");
  }, [hideMission, value, onChange]);

  return (
    <div
      className="mc-tabrow flex-shrink-0 gap-3 px-4 py-2 md:px-8"
      data-testid="mission-tabrow"
    >
      <MissionSegmented
        options={hideMission ? TABS.filter((t) => t.value !== "mission") : TABS}
        value={value}
        onChange={onChange}
        ariaLabel="Task detail view"
      />
      <span className="grow" aria-hidden="true" />
      <Link
        to={SHIPS_LOG_ROUTE}
        className="btn-glass inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#0E7A6B)]"
        data-testid="mission-open-ships-log"
        title="The project's logbook — every run, the accumulated proof"
      >
        <BookOpen size={14} aria-hidden="true" />
        Open Ship&rsquo;s Log
      </Link>
    </div>
  );
}
