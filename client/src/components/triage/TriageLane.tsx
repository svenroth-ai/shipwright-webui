/*
 * TriageLane — one dark "glass" lane of the Triage page
 * (iterate-2026-11-12-triage-lanes-rows): the same recipe as the task-board
 * columns (boardColumnStyles.ts: dark warm glass tinted in the lane's colour,
 * 3px accent bar, white header) but laid out as a horizontal lane per project.
 * The header carries a drag handle (project lanes only) so the operator can
 * put projects in their own order; the arrow keys on the focused handle do
 * the same without a mouse. Rows are TriageItemRow.
 */

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

import type { TriageGroup } from "../../lib/triageGrouping";
import { entryKey, type TriageEntry } from "../../lib/triageFilterSort";
import { TriageItemRow } from "./TriageItemRow";
import type { FixNowIntent } from "./fixNowIntent";

const DARK_GLASS = "var(--triage-lane-solid)"; /* solid (triage-rows.css): rows must stay readable over the photo */
const GLASS_EDGE = "rgba(255, 255, 255, 0.18)";

interface Props {
  group: TriageGroup;
  /** False for the headerless "none" grouping. */
  showHeader: boolean;
  isCollapsed: boolean;
  /** False renders a plain heading (the Parked lane never folds). */
  collapsible?: boolean;
  onToggle: () => void;
  /** Set only for project lanes that can be reordered. */
  reorder?: { onMove: (direction: -1 | 1) => void; canUp: boolean; canDown: boolean };
  projectLabel: (projectId: string) => string | undefined;
  onOpen: (e: TriageEntry) => void;
  onFixNow: (projectId: string, intent: FixNowIntent) => void;
  onNavigateToBoard: (projectId: string) => void;
}

export function TriageLane({
  group: g,
  showHeader,
  isCollapsed,
  collapsible = true,
  onToggle,
  reorder,
  projectLabel,
  onOpen,
  onFixNow,
  onNavigateToBoard,
}: Props) {
  const drop = useDroppable({ id: g.key, disabled: !reorder });
  const drag = useDraggable({ id: g.key, disabled: !reorder });
  const accent = g.color ?? "rgba(255,255,255,0.35)";

  const headInner = (
    <>
      {collapsible && (isCollapsed ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />)}
      {g.color && (
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">{g.label}</span>
      <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-white/90 px-1.5 text-[11px] font-bold text-[var(--g700)]">
        {g.entries.length}
      </span>
    </>
  );

  return (
    <section
      ref={drop.setNodeRef}
      className="overflow-hidden rounded-[var(--radius-card)]"
      style={{
        background: `color-mix(in srgb, ${accent} 12%, ${DARK_GLASS})`,
        border: `1px solid color-mix(in srgb, ${accent} 32%, ${GLASS_EDGE})`,
        boxShadow: "var(--sh-photo)",
        opacity: drag.isDragging ? 0.55 : 1,
        outline: drop.isOver && !drag.isDragging ? "2px dashed var(--color-primary)" : undefined,
        outlineOffset: drop.isOver ? "-2px" : undefined,
      }}
      data-testid={`triage-group-${g.key}`}
    >
      <div aria-hidden="true" className="h-[3px] w-full" style={{ background: accent }} />
      {showHeader && (
        <h2 className="m-0 flex items-center gap-2 px-2 py-2.5 text-base font-semibold text-white/95">
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
                const dir = e.key === "ArrowUp" && reorder.canUp ? -1 : e.key === "ArrowDown" && reorder.canDown ? 1 : 0;
                if (!dir) return;
                e.preventDefault();
                reorder.onMove(dir);
                // The moved lane's DOM node may be re-inserted, which drops focus.
                const sel = `[data-testid="triage-group-handle-${g.key}"]`;
                requestAnimationFrame(() => document.querySelector<HTMLElement>(sel)?.focus());
              }}
              aria-label={`Move project ${g.label} (drag, or use the up and down arrow keys)`}
              title="Drag to reorder projects"
              data-testid={`triage-group-handle-${g.key}`}
              className="inline-flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-white/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white active:cursor-grabbing"
            >
              <GripVertical size={18} aria-hidden="true" />
            </button>
          ) : (
            <span className="w-1" aria-hidden="true" />
          )}
          {collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              data-testid={`triage-group-toggle-${g.key}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {headInner}
            </button>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2" data-testid={`triage-group-title-${g.key}`}>
              {headInner}
            </span>
          )}
        </h2>
      )}
      {!isCollapsed && (
        <ul className="m-0 list-none p-0" data-testid={`triage-grid-${g.key}`}>
          {g.entries.map((e) => (
            <TriageItemRow
              key={entryKey(e)}
              projectId={e.projectId}
              item={e.item}
              projectLabel={projectLabel(e.projectId)}
              onOpen={() => onOpen(e)}
              onFixNow={onFixNow}
              onNavigateToBoard={onNavigateToBoard}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
