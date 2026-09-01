/*
 * ProjectPill — extracted out of TaskCard.tsx (iterate-2026-09-01-
 * lead-board-surface) to reclaim bloat-baseline headroom for the new
 * LeadOriginGlyph/TaskCardLeadExpander wiring — no behavior change.
 *
 * Iterate-2026-05-15 (ADR-105) — project identity chip for the card meta
 * row. Leftmost element, left of the StatePill. A solid dot + the project
 * name, with the pill tinted + bordered in the project's accent color so
 * a multi-project board is scannable at a glance. `color.hsl` is either
 * the custom `settings.color` or a deterministic hash-derived hue, so the
 * pill, dot, and the 3 px left-edge strip all agree. `color-mix` keeps the
 * tint/border derivation format-agnostic (custom hex OR `hsl(...)`).
 * Read-only — clicks fall through to the card's navigate-to-detail
 * handler, no stopPropagation.
 */
import type { ProjectColor } from "../../lib/projectColor";

export function ProjectPill({
  taskId,
  projectId,
  name,
  color,
}: {
  taskId: string;
  projectId: string;
  name: string;
  color: ProjectColor;
}) {
  return (
    <span
      data-testid={`task-card-project-${taskId}`}
      data-project-id={projectId}
      data-project-color={color.hsl}
      title={`Project: ${name}`}
      className="inline-flex max-w-[150px] items-center gap-1.5 rounded-[10px] border px-2 py-[2px] text-[11px] font-semibold text-[var(--color-text)]"
      style={{
        background: `color-mix(in srgb, ${color.hsl} 14%, var(--color-surface))`,
        borderColor: `color-mix(in srgb, ${color.hsl} 42%, transparent)`,
      }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color.hsl }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
