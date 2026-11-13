/*
 * InboxProjectSection — one project's group of cards (C7 — 2026-05-26;
 * Triage look 2026-11-13). No lane: a solid header pill (drag handle, fold
 * chevron, project colour dot, name, count) above the project's cards. The
 * project colour is handed to the cards as `--acc` (their 3px top bar + glass
 * tint). The handle drags the group (or the arrow keys on the focused handle
 * move it) — the same mechanics as a Triage lane — and the pill folds it.
 *
 * Sessions are no longer a visual level: each card carries its own session
 * chip (InboxCardShell). The `inbox-session-<uuid>` wrapper stays so the DOM
 * keeps one node per session, in input order.
 */
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import { getProjectColor } from "../../lib/projectColor";
import type { ExternalTask } from "../../lib/externalApi";
import type { ProjectGroup } from "./types";
import { InboxCard, inboxItemKey } from "./InboxCard";

/** No project colour (the Unassigned bucket): a neutral white tint, like an unowned Triage lane. */
const NEUTRAL_ACCENT = "rgba(255, 255, 255, 0.35)";

export interface InboxGroupReorder {
  onMove: (direction: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}

export function InboxProjectSection({
  group,
  tasksById,
  isCollapsed = false,
  onToggle,
  reorder,
}: {
  group: ProjectGroup;
  tasksById: Map<string, ExternalTask>;
  isCollapsed?: boolean;
  onToggle?: () => void;
  /** Set only when the groups can be reordered (more than one group). */
  reorder?: InboxGroupReorder;
}) {
  const isUnassigned = group.projectId === UNASSIGNED_PROJECT_ID;
  const accent = isUnassigned
    ? NEUTRAL_ACCENT
    : getProjectColor(group.projectId, group.project?.settings?.color).hsl;

  const drop = useDroppable({ id: group.projectId, disabled: !reorder });
  const drag = useDraggable({ id: group.projectId, disabled: !reorder });

  return (
    <section
      ref={drop.setNodeRef}
      className="inbox-group"
      style={{
        ["--acc" as string]: accent,
        opacity: drag.isDragging ? 0.55 : 1,
        outline: drop.isOver && !drag.isDragging ? "2px dashed var(--color-primary)" : undefined,
        outlineOffset: drop.isOver ? "4px" : undefined,
      }}
      data-testid={`inbox-project-group-${group.projectId}`}
    >
      <h2 className="inbox-group-head m-0">
        {reorder ? (
          <button
            type="button"
            ref={drag.setNodeRef}
            {...drag.listeners}
            {...drag.attributes}
            // No KeyboardSensor: the arrow keys below are the keyboard path, so
            // drop dnd-kit's "press space to pick up" announcement.
            aria-describedby={undefined}
            aria-roledescription={undefined}
            onKeyDown={(e) => {
              const dir =
                e.key === "ArrowUp" && reorder.canUp
                  ? -1
                  : e.key === "ArrowDown" && reorder.canDown
                    ? 1
                    : 0;
              if (!dir) return;
              e.preventDefault();
              reorder.onMove(dir);
              // The moved group's DOM node may be re-inserted, which drops focus.
              const sel = `[data-testid="inbox-group-handle-${group.projectId}"]`;
              requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus());
            }}
            aria-label={`Move project ${group.projectName} (drag, or use the up and down arrow keys)`}
            title="Drag to reorder projects"
            data-testid={`inbox-group-handle-${group.projectId}`}
            className="inline-flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white active:cursor-grabbing"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        ) : (
          <span className="w-2" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          aria-controls={`inbox-group-cards-${group.projectId}`}
          data-testid={`inbox-project-group-toggle-${group.projectId}`}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {isCollapsed ? (
            <ChevronRight size={15} aria-hidden="true" />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
          <span
            aria-hidden="true"
            data-testid={`inbox-group-color-${group.projectId}`}
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          <span className="min-w-0 truncate">{group.projectName}</span>
          <span className="inbox-group-count" data-testid={`inbox-group-count-${group.projectId}`}>
            {group.totalItems}
          </span>
        </button>
      </h2>

      {!isCollapsed && (
        <div className="inbox-group-cards" id={`inbox-group-cards-${group.projectId}`}>
          {group.sessions.map((sg) => {
            const task = tasksById.get(sg.taskId);
            return (
              <div
                key={sg.sessionUuid}
                className="inbox-group-cards"
                data-testid={`inbox-session-${sg.sessionUuid}`}
              >
                {sg.items.map((item) => (
                  <InboxCard key={inboxItemKey(item)} item={item} task={task} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
