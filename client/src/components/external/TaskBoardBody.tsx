/*
 * TaskBoardBody — the Task Board's body render-state chain (loading /
 * load-error / no-filter-matches / list-view / A07 empty / kanban columns),
 * extracted out of TaskBoardPage so that grandfathered, size-capped file
 * does not grow (same rationale as CampaignsLane's own extraction). FR-01.01
 * triage trg-0f040744 finding 1 — the load-error branch is the reason this
 * chain grew past the file's headroom in the first place.
 */
import type { ExternalTask } from "../../lib/externalApi";
import type { TaskBoardView } from "./ViewToggle";
import { TaskBoardColumns } from "./TaskBoardColumns";
import { TaskBoardEmptyState, TaskBoardNoFilterMatches } from "./TaskBoardEmptyState";
import { TaskList } from "./TaskList";
import { ListLoadErrorState } from "../common/ListLoadErrorState";

interface TaskBoardBodyProps {
  isLoading: boolean;
  tasksError: boolean;
  onRetryTasks: () => void;
  noFilterMatches: boolean;
  onClearFilters: () => void;
  view: TaskBoardView;
  /** The project-filtered (but not status/lead-tag-filtered) list — used only
   *  to decide the A07 zero-tasks empty state, distinct from `noFilterMatches`. */
  projectFiltered: ExternalTask[];
  filteredTasks: ExternalTask[];
  onCreate: () => void;
}

export function TaskBoardBody({
  isLoading,
  tasksError,
  onRetryTasks,
  noFilterMatches,
  onClearFilters,
  view,
  projectFiltered,
  filteredTasks,
  onCreate,
}: TaskBoardBodyProps) {
  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--color-muted)]">Loading…</div>;
  }

  // FR-01.01 triage trg-0f040744 finding 1 — a failed load is not the same
  // claim as "you have zero tasks"; never fall into the A07 teaching empty
  // state on an error.
  if (tasksError) {
    return <ListLoadErrorState testId="task-board-load-error" label="tasks" onRetry={onRetryTasks} />;
  }

  if (noFilterMatches) {
    return <TaskBoardNoFilterMatches onClear={onClearFilters} />;
  }

  if (view === "list") {
    // iterate 3.7h (Sven UAT): wrap TaskList in .page-container so the
    // table respects the same L/R gutters as the header + filter row.
    // `w-full` forces the container to stretch to parent width; without
    // it the page-container shrunk to the inner content width (was
    // 889px instead of the expected 1280) because TaskList's child
    // wrapper didn't force horizontal stretch.
    // iterate-2026-07-21-mac-titlebar-right-clip: the outer wrapper is the
    // scroll BOUNDARY. Kanban bounds itself (TaskBoardColumns' rail is
    // overflow-x-auto/overflow-y-hidden and each column scrolls), but list
    // view used to hand its overflow up to the shell scroller — which then
    // grew a real 15px scrollbar and clipped the title bar all over again
    // (measured: /?view=list overflowed the shell by ~19000px, headGap 15).
    // The scroller is OUTSIDE .page-container so the scrollbar rides the
    // window edge, not the centred 1280 box — same shape as Diagnostics.
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-container w-full pt-6 pb-8">
          <TaskList tasks={filteredTasks} />
        </div>
      </div>
    );
  }

  if (projectFiltered.length === 0) {
    // A07 teaching empty state (zero tasks). A08 (FR-01.51): its CTA opens
    // the guided Intent Wizard — direct/expert create stays in the header
    // split button.
    return <TaskBoardEmptyState canCreate onCreate={onCreate} />;
  }

  // iterate-2026-06-17 — grid + grouping + drag-and-drop extracted to
  // TaskBoardColumns; grouping is by boardColumn (decoupled from state).
  return <TaskBoardColumns tasks={filteredTasks} />;
}
