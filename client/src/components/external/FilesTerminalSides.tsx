/*
 * FilesTerminalSides — the left and right cards of the Files & Terminal row
 * (mission-desktop-style-v2 V8). Both REUSE the Mission tab's components: the
 * left card is the shared flat FolderTree (+ row context menu), the right card
 * is the shared MissionInfoSidebar with the segments Info | Viewer only. Their
 * heads are the shared 46px `.ft-head` band; the terminal in the middle is
 * composed by the page and untouched.
 */
import type { ExternalTask } from "../../lib/externalApi";
import type { ViewerTarget } from "../../lib/viewerTarget";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import { useProject } from "../../hooks/useProjects";
import { FolderTree } from "./FolderTree";
import { useFocusMode } from "./focus-mode-context";
import { MissionInfoSidebar } from "./mission/MissionInfoSidebar";
import type { RightSegment } from "./PaneTabBar";

export function FilesCard({
  task,
  selectedPath,
  onSelect,
}: {
  task: ExternalTask;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const unassigned = task.projectId === UNASSIGNED_PROJECT_ID;
  const project = useProject(unassigned ? "" : task.projectId).data;
  return (
    <section className="ft-card ft-files flex h-full min-h-0 flex-col" data-testid="task-detail-files">
      <FolderTree
        headBand
        projectId={task.projectId}
        selectedPath={selectedPath}
        onSelect={onSelect}
        projectRoot={project?.path ?? null}
      />
    </section>
  );
}

interface ViewCardProps {
  task: ExternalTask;
  compact: boolean;
  /** False while the Files & Terminal tab is not the one on screen. */
  visible: boolean;
  segment: RightSegment;
  onSegmentChange: (segment: RightSegment) => void;
  request: { target: ViewerTarget; nonce: number } | null;
  onActivePathChange: (path: string | null) => void;
}

export function ViewCard({ task, compact, visible, segment, onSegmentChange, request, onActivePathChange }: ViewCardProps) {
  const { viewer, sidebar } = useFocusMode();
  // Tablet hides the card through the viewer toggle; desktop through the sidebar collapse.
  const onCollapse = viewer.available ? viewer.toggle : sidebar.available ? sidebar.toggle : undefined;
  return (
    <aside className="ft-card ft-view flex h-full min-h-0 flex-col" data-testid="task-detail-viewer">
      <MissionInfoSidebar
        task={task}
        compact={compact}
        visible={visible}
        request={request}
        embed={{ segment, onSegmentChange, headless: compact, onCollapse, onActivePathChange }}
      />
    </aside>
  );
}
