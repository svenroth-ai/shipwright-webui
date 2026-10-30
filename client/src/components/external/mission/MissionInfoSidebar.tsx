/*
 * MissionInfoSidebar — the Mission tab's right sidebar (M3, Smart Viewer
 * pattern): segments Info / Folders / Viewer, resizable + collapsible on
 * desktop with the layout remembered per browser. Folders reuses the task
 * detail's FolderTree; Viewer reuses SmartViewer. In compact mode the whole
 * card is the "Info" tab panel (no splitter / collapse).
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import {
  SIDEBAR_MAX,
  clampSidebarWidth,
  SIDEBAR_MIN,
  useMissionSidebar,
  type MissionSidebarSegment,
} from "../../../hooks/useMissionSidebar";
import { UNASSIGNED_PROJECT_ID } from "../../../lib/projectIds";
import { FolderTree } from "../FolderTree";
import { SmartViewer } from "../SmartViewer";
import { MissionInfoPanel } from "./MissionInfoPanel";
import { MissionSegmented } from "./MissionSegmented";

interface Props {
  task: ExternalTask;
  compact: boolean;
  /** Compact: false while the Info tab is not the selected one. */
  visible?: boolean;
}

const OPTIONS = [
  { value: "info" as const, label: "Info", testId: "mission-side-seg-info" },
  { value: "folders" as const, label: "Folders", testId: "mission-side-seg-folders" },
  { value: "viewer" as const, label: "Viewer", testId: "mission-side-seg-viewer" },
];

export function MissionInfoSidebar({ task, compact, visible = true }: Props) {
  const layout = useMissionSidebar();
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const [path, setPath] = useState<string | null>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  // In-progress drag width: committed (and persisted) once, on release.
  const dragW = useRef<number | null>(null);
  const [liveW, setLiveW] = useState<number | null>(null);

  const open = (p: string) => {
    setPath(p);
    layout.setSegment("viewer");
  };

  if (!compact && layout.collapsed) {
    return (
      <button
        type="button"
        className="mc-side-rail"
        data-testid="mission-side-expand"
        aria-label="Show info sidebar"
        onClick={() => layout.setCollapsed(false)}
      >
        <PanelRightOpen size={16} aria-hidden="true" />
      </button>
    );
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: layout.width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const endDrag = () => {
    if (dragW.current !== null) layout.setWidth(dragW.current);
    drag.current = null;
    dragW.current = null;
    setLiveW(null);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return endDrag();
    if (!drag.current) return;
    dragW.current = clampSidebarWidth(drag.current.w + (drag.current.x - e.clientX));
    setLiveW(dragW.current);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") layout.setWidth(layout.width + 10);
    else if (e.key === "ArrowRight") layout.setWidth(layout.width - 10);
    else if (e.key === "Home") layout.setWidth(SIDEBAR_MIN);
    else if (e.key === "End") layout.setWidth(SIDEBAR_MAX);
    else return;
    e.preventDefault();
  };

  // An unassigned task has no project root: Folders/Viewer have nothing to browse.
  const options = unassigned ? OPTIONS.slice(0, 1) : OPTIONS;
  const seg: MissionSidebarSegment = unassigned ? "info" : layout.segment;

  return (
    <>
      {!compact && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize info sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={liveW ?? layout.width}
          tabIndex={0}
          className="mc-side-split"
          data-testid="mission-side-splitter"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKey}
        />
      )}
      <aside
        className="mc-side"
        style={compact ? undefined : { width: liveW ?? layout.width }}
        aria-label="Session info"
        data-testid="mission-side"
      >
        <div className="mc-side-head">
          <MissionSegmented
            options={options}
            value={seg}
            onChange={(v) => { if (!unassigned) layout.setSegment(v); }}
            ariaLabel="Info sidebar sections"
            variant="ft-seg"
          />
          {!compact && (
            <button
              type="button"
              className="mc-side-collapse"
              data-testid="mission-side-collapse"
              aria-label="Hide info sidebar"
              onClick={() => layout.setCollapsed(true)}
            >
              <PanelRightClose size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mc-side-body" data-testid={`mission-side-body-${seg}`}>
          {seg === "info" && <MissionInfoPanel task={task} onOpenOutput={open} active={visible} />}
          {seg === "folders" && visible && (
            <FolderTree projectId={task.projectId} selectedPath={path} onSelect={open} />
          )}
          {seg === "viewer" && visible && <SmartViewer projectId={task.projectId} path={path} />}
        </div>
      </aside>
    </>
  );
}
