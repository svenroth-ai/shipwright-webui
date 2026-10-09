/*
 * TaskBoardColumns — the 3-column kanban grid + drag-and-drop.
 * iterate-2026-06-17-board-dnd-status-decouple.
 *
 * Extracted out of TaskBoardPage.tsx (which was at its bloat ceiling) so the
 * DnD wiring + per-column styling have a focused home. Grouping is by
 * `resolveBoardColumn(task)` = `task.boardColumn ?? deriveBoardColumn(state)`,
 * so the board column is decoupled from the machine-derived session `state`
 * (the StatePill on the card remains the liveness badge; the Launch/Resume
 * CTA still keys off `state`).
 *
 * DnD: @dnd-kit/core. PointerSensor uses an 8 px activation distance so a
 * click (open detail) / the ⋯-menu / touch tap are NOT swallowed by the
 * drag. KeyboardSensor + dnd-kit's built-in announcer give a keyboard path;
 * the ⋯-menu "Move to column" items (TaskCardMenu) are the robust fallback.
 * Dropping on the current column is a no-op (zero API calls).
 *
 * Preserved testids: task-board-columns, column-draft, column-in-progress,
 * column-done, task-card-<id>.
 */
import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import type { ExternalTask } from "../../lib/externalApi";
import {
  moveReopensTask,
  resolveBoardColumn,
  type BoardColumn,
} from "../../lib/boardColumnApi";
import { sortTasksByLastModifiedDesc } from "../../lib/taskSort";
import { useSetBoardColumn } from "../../hooks/useExternalTasks";
import { TaskCard } from "./TaskCard";

import { COLUMN_META, COLUMN_STYLES, type ColumnMeta } from "./boardColumnStyles";

/**
 * Group tasks into their board columns, each column ordered newest-modified
 * first. Sorting the whole list ONCE up front then bucketing works because the
 * `for…of` push preserves the sorted order per column — the shared comparator
 * (lib/taskSort) is the SAME one the List view's default order uses, so the two
 * views agree card-for-card. There is no manual within-column reordering on the
 * board (DnD only moves cards BETWEEN columns), so a strict time sort clobbers
 * no user layout.
 */
function groupByColumn(tasks: ExternalTask[]): Record<BoardColumn, ExternalTask[]> {
  const out: Record<BoardColumn, ExternalTask[]> = {
    backlog: [],
    in_progress: [],
    done: [],
  };
  for (const t of sortTasksByLastModifiedDesc(tasks)) out[resolveBoardColumn(t)].push(t);
  return out;
}

/** A TaskCard wrapped in a dnd-kit draggable. The 8 px activation distance
 *  (sensor-level) means a tap/click still reaches the card's navigate +
 *  ⋯-menu handlers. */
function DraggableCard({ task, column }: { task: ExternalTask; column: BoardColumn }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.taskId,
    data: { column },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="outline-none"
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
      data-testid={`task-card-draggable-${task.taskId}`}
    >
      <TaskCard task={task} />
    </div>
  );
}

interface DroppableColumnProps {
  meta: ColumnMeta;
  items: ExternalTask[];
}

function DroppableColumn({ meta, items }: DroppableColumnProps) {
  const s = COLUMN_STYLES[meta.tone];
  const { setNodeRef, isOver } = useDroppable({ id: meta.col });
  return (
    <div
      ref={setNodeRef}
      // md+ (tablet AND desktop): the three lanes SHARE the width (basis-0 grow,
      // min 200, capped at the 360px design width) so they never need a
      // horizontal scroll — iPad landscape (1024–1366px) used to hit the old
      // fixed `lg:w-[360px]` x3 and scroll sideways. Wide desktops still cap
      // at 360 and `lg:justify-between` spreads them exactly as before. Only
      // phones (<768px) keep the 360px swipe carousel.
      className="flex max-h-full w-[360px] min-w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-card)] md:w-auto md:min-w-[200px] md:max-w-[360px] md:shrink md:grow md:basis-0"
      style={{
        // Colored-GLASS lane panel (Sven feedback 2026-07-17): a translucent
        // dark tint in the column's own colour + a backdrop blur, so the deck
        // photo shimmers through softly and the white cards pop. The dark glass
        // is what keeps the WHITE lane header AA over the photo (see COLUMN_STYLES).
        background: s.panel.bg,
        border: `1px solid ${s.panel.border}`,
        backdropFilter: "blur(14px) saturate(1.1)",
        WebkitBackdropFilter: "blur(14px) saturate(1.1)",
        boxShadow: "var(--sh-photo)",
        outline: isOver ? "2px dashed var(--color-primary)" : undefined,
        outlineOffset: isOver ? "-2px" : undefined,
      }}
      data-testid={meta.testId}
      data-board-column={meta.col}
      data-drop-over={isOver ? "true" : undefined}
    >
      <div aria-hidden="true" className="h-[3px] w-full" style={{ background: s.border }} />
      <div
        className="flex items-center gap-2 px-[14px] pb-[10px] pt-[14px] text-[13px] font-semibold uppercase tracking-[0.04em]"
        style={{ color: s.header }}
      >
        <span>{meta.title}</span>
        <span
          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] px-1.5 text-[11px] font-bold"
          style={{ background: s.count.bg, color: s.count.fg }}
        >
          {items.length}
        </span>
      </div>
      {/* [&>*]:shrink-0 — bounded column-flex scroller; see
          components/common/ModalScrollBody.tsx for the invariant. NB the
          direct child is DraggableCard's wrapper div, so TaskCard's own
          shrink-0 is a grandchild and does NOT guard this container. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-[10px] pb-[14px] [&>*]:shrink-0">
        {items.length === 0 && (
          <div className="py-1 text-[11px] text-[var(--color-muted)]">none</div>
        )}
        {items.map((t) => (
          <DraggableCard key={t.taskId} task={t} column={meta.col} />
        ))}
      </div>
    </div>
  );
}

export function TaskBoardColumns({ tasks }: { tasks: ExternalTask[] }) {
  // Memoized so the sort + regroup only runs when the task list itself changes,
  // not on every unrelated re-render (drag state, hover) — external-review perf
  // fold. The ~2 s poll returns a fresh array reference, which correctly busts
  // the memo and re-sorts.
  const columns = useMemo(() => groupByColumn(tasks), [tasks]);
  const setColumn = useSetBoardColumn();
  const [activeTask, setActiveTask] = useState<ExternalTask | null>(null);

  // Multi-input activation so a click (open detail) / ⋯-menu / touch tap /
  // touch scroll are never swallowed by the drag (plan-review MED fold):
  //   mouse → 8 px distance · touch → 200 ms press-hold (scroll preserved)
  //   keyboard → KeyboardSensor (Space to lift, arrows to move, Space to drop).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = useCallback(
    (ev: DragStartEvent) => {
      setActiveTask(tasks.find((t) => t.taskId === ev.active.id) ?? null);
    },
    [tasks],
  );

  const onDragEnd = useCallback(
    (ev: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = ev;
      if (!over) return;
      const target = over.id as BoardColumn;
      const source = active.data.current?.column as BoardColumn | undefined;
      // Same-column drop → zero API calls (plan-review fold, Gemini #5).
      if (source === target) return;
      // A terminal `done` card dragged OUT of Done must reopen (done → draft)
      // so it lands UNLOCKED with a CTA, not stranded "done" + locked in the
      // new column (board-drag-done-reopen). Live cards stay a pure column move.
      const task = tasks.find((t) => t.taskId === String(active.id));
      setColumn.mutate({
        taskId: String(active.id),
        column: target,
        reopen: task ? moveReopensTask(task.state, target) : false,
      });
    },
    [setColumn, tasks],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      <div
        className="density-surface page-container flex w-full flex-1 items-start justify-start gap-6 overflow-x-auto overflow-y-hidden pt-6 pb-8 snap-x snap-mandatory scroll-pl-6 md:snap-none md:scroll-pl-0 lg:justify-between lg:snap-none lg:scroll-pl-0"
        data-testid="task-board-columns"
        data-page-container="true"
      >
        {COLUMN_META.map((meta) => (
          <DroppableColumn key={meta.col} meta={meta} items={columns[meta.col]} />
        ))}
      </div>
      {/* dropAnimation={null} — dnd-kit's default drop animation flies the
          dragged clone back to the SOURCE draggable's position on release.
          A board move relocates the card to the target column (optimistic
          useSetBoardColumn) at the same instant, so the default reads as the
          clone "flipping back to the origin" while the real card is already
          at the destination. Disabling it lets the overlay just vanish on
          drop (board-drop-animation). Guard: TaskBoardColumns.dropanim.test.tsx. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCard task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
