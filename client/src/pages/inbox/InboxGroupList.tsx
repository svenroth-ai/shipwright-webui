/*
 * InboxGroupList — the project groups of the Inbox, in the user's own order
 * (iterate-2026-11-13-inbox-triage-look). Same mechanics as TriageGroupList:
 * a dnd-kit context around the groups; the header handle of a group drags it
 * (or the arrow keys on the focused handle move it) and the new order goes to
 * `onReorderProject`, which the page persists (useInboxViewState).
 */
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import type { ExternalTask } from "../../lib/externalApi";
import { InboxProjectSection } from "./InboxProjectSection";
import type { ProjectGroup } from "./types";

interface Props {
  groups: readonly ProjectGroup[];
  tasksById: Map<string, ExternalTask>;
  collapsed: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  /** Move project `movedId` onto the place of `overId` (both project ids). */
  onReorderProject: (movedId: string, overId: string) => void;
}

export function InboxGroupList({
  groups,
  tasksById,
  collapsed,
  onToggle,
  onReorderProject,
}: Props) {
  // A click on the handle must stay a click; touch needs a press-hold so the page still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const reorderable = groups.length > 1;

  const onDragEnd = (ev: DragEndEvent): void => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    onReorderProject(String(ev.active.id), String(ev.over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-9 max-md:gap-6" data-testid="inbox-list">
        {groups.map((g, i) => (
          <InboxProjectSection
            key={g.projectId}
            group={g}
            tasksById={tasksById}
            isCollapsed={collapsed.has(g.projectId)}
            onToggle={() => onToggle(g.projectId)}
            reorder={
              reorderable
                ? {
                    canUp: i > 0,
                    canDown: i < groups.length - 1,
                    onMove: (d) => {
                      const target = groups[i + d];
                      if (target) onReorderProject(g.projectId, target.projectId);
                    },
                  }
                : undefined
            }
          />
        ))}
      </div>
    </DndContext>
  );
}
