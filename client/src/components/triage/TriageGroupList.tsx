/*
 * TriageGroupList — the open-items list as dark lanes, one per group
 * (iterate-2026-11-12-triage-lanes-rows; was a card grid). "none" renders one
 * headerless lane. When grouped by project the lanes can be reordered by the
 * header handle (drag, or arrow keys on the handle); the new order is handed
 * to `onReorderProject` and persisted by the page's view state. Every row is
 * keyed `projectId:itemId` because triage ids can collide across projects.
 */

import { DndContext, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";

import type { GroupBy, TriageGroup } from "../../lib/triageGrouping";
import type { TriageEntry } from "../../lib/triageFilterSort";
import { TriageLane } from "./TriageLane";
import type { FixNowIntent } from "./fixNowIntent";

const PROJECT_PREFIX = "project:";

interface Props {
  groups: readonly TriageGroup[];
  groupBy: GroupBy;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Label per project, shown on rows when not grouped by project. */
  projectLabel: (projectId: string) => string | undefined;
  onOpen: (e: TriageEntry) => void;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
  /** Move project `movedId` onto the place of `overId` (both project ids). */
  onReorderProject?: (movedId: string, overId: string) => void;
}

export function TriageGroupList({
  groups,
  groupBy,
  collapsed,
  onToggle,
  projectLabel,
  onOpen,
  onFixNow,
  onNavigateToBoard,
  onReorderProject,
}: Props) {
  // A click on the handle must stay a click; touch needs a press-hold so the page still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const reorderable = groupBy === "project" && groups.length > 1 && !!onReorderProject;
  const projectId = (key: string): string => key.slice(PROJECT_PREFIX.length);

  const onDragEnd = (ev: DragEndEvent): void => {
    if (!onReorderProject || !ev.over || ev.active.id === ev.over.id) return;
    onReorderProject(projectId(String(ev.active.id)), projectId(String(ev.over.id)));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-9 max-md:gap-6" data-testid="triage-open-items">
        {groups.map((g, i) => {
          // A group holding a returned park never stays folded: the bypass must
          // survive a collapse saved days ago.
          const isCollapsed =
            groupBy !== "none" && collapsed.has(g.key) && !g.entries.some((e) => e.item.revisitDue);
          return (
            <TriageLane
              key={g.key}
              group={g}
              showHeader={groupBy !== "none"}
              isCollapsed={isCollapsed}
              onToggle={() => onToggle(g.key)}
              reorder={
                reorderable
                  ? {
                      canUp: i > 0,
                      canDown: i < groups.length - 1,
                      onMove: (d) => {
                        const target = groups[i + d];
                        if (target) onReorderProject?.(projectId(g.key), projectId(target.key));
                      },
                    }
                  : undefined
              }
              projectLabel={groupBy === "project" ? () => undefined : projectLabel}
              onOpen={onOpen}
              onFixNow={onFixNow}
              onNavigateToBoard={onNavigateToBoard}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
