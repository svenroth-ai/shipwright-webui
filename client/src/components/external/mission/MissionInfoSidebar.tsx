/*
 * MissionInfoSidebar — the Mission tab's right sidebar (M3, Smart Viewer
 * pattern): segments Info / Folders / Viewer, resizable + collapsible on
 * desktop with the layout remembered per browser. Folders reuses the task
 * detail's FolderTree; Viewer reuses SmartViewer. In compact mode the whole
 * card is the "Info" tab panel (no splitter / collapse).
 *
 * `embed` (V8) hosts the SAME component inside the Files & Terminal three-pane:
 * segments Info | Viewer only, the segment owned by the page (the phone tab bar
 * drives it), the segmented control sits in the shared 46px `.ft-head` band, and
 * opened files stay as tabs above the viewer. The three-pane owns width/collapse.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
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
import type { ViewerTarget } from "../../../lib/viewerTarget";
import { useProject } from "../../../hooks/useProjects";
import { FolderTree } from "../FolderTree";
import { SmartViewer } from "../SmartViewer";
import { ViewerTabBar } from "../SmartViewer/ViewerTabBar";
import { MissionInfoPanel } from "./MissionInfoPanel";
import { MissionSegmented } from "./MissionSegmented";

/** Files & Terminal hosting: page-owned segment, head band, no own splitter. */
export interface SidebarEmbed {
  segment: "info" | "viewer";
  onSegmentChange: (segment: "info" | "viewer") => void;
  /** Phone: the page tab bar replaces the in-card segmented control. */
  headless?: boolean;
  /** Desktop/tablet: hides the card (the shell owns the collapsed state). */
  onCollapse?: () => void;
  /** Tree highlight: the project path of the viewer tab in front (null = none). */
  onActivePathChange?: (path: string | null) => void;
}

interface Props {
  task: ExternalTask;
  compact: boolean;
  /** Compact: false while the Info tab is not the selected one. */
  visible?: boolean;
  /** Open a file in the Viewer from outside (chat chips): the nonce makes a repeat of the
   *  same target re-open the Viewer after the user switched away. */
  request?: { target: ViewerTarget; nonce: number } | null;
  embed?: SidebarEmbed;
}

const OPTIONS = [
  { value: "info" as const, label: "Info", testId: "mission-side-seg-info" },
  { value: "folders" as const, label: "Folders", testId: "mission-side-seg-folders" },
  { value: "viewer" as const, label: "Viewer", testId: "mission-side-seg-viewer" },
];
// Files & Terminal keeps its own test ids: both tabs stay mounted, so shared ids would collide.
const EMBED_OPTIONS = OPTIONS.filter((o) => o.value !== "folders").map((o) => ({
  ...o,
  testId: o.testId.replace("mission-side", "ft-side"),
}));

export function MissionInfoSidebar({ task, compact, visible = true, request = null, embed }: Props) {
  const layout = useMissionSidebar();
  const embedRef = useRef(embed);
  embedRef.current = embed;
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const project = useProject(unassigned ? "" : task.projectId).data;
  const projectRoot = project?.path ?? null;
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const [tabs, setTabs] = useState<ViewerTarget[]>([]);
  // Synchronous mirror so two updates in one tick (rapid close / open) never act on a stale list.
  const tabsRef = useRef<ViewerTarget[]>([]);
  const commitTabs = (next: ViewerTarget[]) => {
    tabsRef.current = next;
    setTabs(next);
  };
  const [focusKey, setFocusKey] = useState(0);
  const drag = useRef<{ x: number; w: number } | null>(null);
  // In-progress drag width: committed (and persisted) once, on release.
  const dragW = useRef<number | null>(null);
  const [liveW, setLiveW] = useState<number | null>(null);

  const setSeg = (s: MissionSidebarSegment) => {
    if (embed) embed.onSegmentChange(s === "viewer" ? "viewer" : "info");
    else layout.setSegment(s);
  };
  // A re-open replaces the stored target (latest line) and keeps the tab position.
  const addTab = (t: ViewerTarget) => {
    const prev = tabsRef.current;
    commitTabs(prev.some((x) => x.path === t.path) ? prev.map((x) => (x.path === t.path ? t : x)) : [...prev, t]);
  };
  const openTarget = (t: ViewerTarget) => {
    setTarget(t);
    addTab(t);
    setSeg("viewer");
  };
  const closeTab = (path: string) => {
    const rest = tabsRef.current.filter((x) => x.path !== path);
    commitTabs(rest);
    setTarget((cur) => (cur?.path === path ? (rest[rest.length - 1] ?? null) : cur));
  };

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    if (!request) return;
    setTarget(request.target);
    addTab(request.target);
    setFocusKey(request.nonce);
    if (embedRef.current) embedRef.current.onSegmentChange("viewer");
    else {
      layoutRef.current.setSegment("viewer");
      layoutRef.current.setCollapsed(false);
    }
  }, [request]);
  useEffect(() => {
    embedRef.current?.onActivePathChange?.(target && !target.outside ? target.path : null);
  }, [target]);

  if (!embed && !compact && layout.collapsed) {
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

  // An unassigned task has no project root to browse (no Folders), but session files still open.
  const options = embed ? EMBED_OPTIONS : unassigned ? OPTIONS.filter((o) => o.value !== "folders") : OPTIONS;
  const stored: MissionSidebarSegment = embed ? embed.segment : layout.segment;
  const seg: MissionSidebarSegment = unassigned && stored === "folders" ? "info" : stored;
  const viewer = (
    <SmartViewer projectId={task.projectId} path={target?.path ?? null} sessionTaskId={target?.outside ? task.taskId : undefined} line={target?.line} focusKey={focusKey} />
  );
  const segmented = (
    <MissionSegmented
      options={options}
      value={seg}
      onChange={setSeg}
      ariaLabel="Info sidebar sections"
      variant={embed ? "ft-seg" : "default"}
    />
  );

  if (embed) {
    return (
      <aside className="mc-side mc-side-embed" aria-label="Session info" data-testid="ft-side">
        {!embed.headless && (
          <div className="ft-head" data-testid="task-detail-viewer-head">
            {segmented}
            {embed.onCollapse && (
              <button type="button" className="mc-side-collapse" data-testid="ft-side-collapse" aria-label="Hide info sidebar" onClick={embed.onCollapse}>
                <PanelRightClose size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {visible && seg === "info" && (
          <div className="mc-side-body" data-testid="ft-side-body-info">
            <MissionInfoPanel task={task} onOpenOutput={openTarget} active={visible} />
          </div>
        )}
        {visible && seg === "viewer" && (
          <div className="mc-side-flush" data-testid="ft-side-body-viewer">
            <ViewerTabBar
              paths={tabs.map((t) => t.path)}
              activePath={target?.path ?? null}
              onActivate={(p) => setTarget(tabs.find((x) => x.path === p) ?? target)}
              onClose={closeTab}
            />
            <div className="min-h-0 flex-1">{viewer}</div>
          </div>
        )}
      </aside>
    );
  }

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
          {segmented}
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
          {seg === "info" && <MissionInfoPanel task={task} onOpenOutput={openTarget} active={visible} />}
          {seg === "folders" && visible && (
            <FolderTree projectId={task.projectId} selectedPath={target?.outside ? null : (target?.path ?? null)} onSelect={(p) => openTarget({ path: p, outside: false })} projectRoot={projectRoot} label={project?.name ?? null} />
          )}
          {seg === "viewer" && visible && viewer}
        </div>
      </aside>
    </>
  );
}
