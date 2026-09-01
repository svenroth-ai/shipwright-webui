/*
 * TaskCard lead metadata — the bot glyph (next to the ProjectPill) and the
 * in-place expander showing already-persisted-but-hidden fields (`domain`,
 * `priority`, `complexityHint`, the three lead tags). FR-04.11 / plan V3.
 *
 * `LeadOriginGlyph` is gated ONLY on a `lead:` origin tag — never the
 * broader `hasAnyLeadTag` — so a task carrying only `lead-wait:` or
 * `lead-dedup:` (no origin tag) does not get a false-positive glyph
 * (external plan review finding, both reviewers).
 *
 * `TaskCardLeadExpander` renders nothing when the task has none of
 * domain/priority/complexityHint set AND no lead tag — a task with only
 * unrelated, non-lead tags must not open an expander with nothing
 * meaningful in it (external plan review finding). It follows the existing
 * `TaskDescriptionDisclosure` "expand in place" shape (chevron toggle +
 * conditionally-rendered panel), never a Dialog/Portal — the brief wants an
 * expander ON the card, not a page change. `stopPropagation()` is applied
 * to the WHOLE wrapper (toggle AND panel), not just the toggle button, so a
 * click anywhere inside the open panel never reaches the card's
 * `navigateToDetail` handler either.
 */
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import {
  dedupKey,
  hasAnyLeadTag,
  isLeadOriginated,
  isWaitingOnPo,
  hasDedupTag,
  leadOriginId,
} from "../../lib/leadTags";

interface GlyphProps {
  taskId: string;
  tags?: string[] | null;
}

/** Small bot glyph rendered immediately before ProjectPill in the card's
 *  meta row — a lead-originated task only. Renders nothing otherwise.
 *  `role="img"` + `aria-label` (not `aria-hidden` + `title`) because this
 *  glyph is the SOLE signal a card is lead-originated — `aria-hidden`
 *  removes the whole subtree, including `title`, from assistive tech
 *  (code review finding). */
export function LeadOriginGlyph({ taskId, tags }: GlyphProps) {
  if (!isLeadOriginated(tags)) return null;
  return (
    <span
      role="img"
      aria-label="Lead-originated task"
      data-testid={`task-card-lead-glyph-${taskId}`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted-bg)] text-[var(--color-muted)]"
    >
      <Bot size={12} aria-hidden="true" />
    </span>
  );
}

interface ExpanderProps {
  task: ExternalTask;
}

const PRIORITY_CLASS: Record<NonNullable<ExternalTask["priority"]>, string> = {
  P0: "bg-err-tint text-err",
  P1: "bg-warn-tint text-warn",
  P2: "bg-warn-tint text-warn",
  P3: "bg-inset text-[var(--color-text)]",
};

export function TaskCardLeadExpander({ task }: ExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const hasLeadTag = hasAnyLeadTag(task.tags);
  const hasMetadata =
    Boolean(task.domain) || Boolean(task.priority) || Boolean(task.complexityHint);
  if (!hasLeadTag && !hasMetadata) return null;

  const stop = (ev: MouseEvent | PointerEvent) => ev.stopPropagation();
  // The card is draggable (TaskBoardColumns' DraggableCard spreads dnd-kit's
  // useDraggable listeners — incl. a PointerSensor and a KeyboardSensor —
  // onto an outer wrapper this component doesn't control). stopPropagation
  // on click alone covers a stationary click (the sensor's 8px activation
  // distance already prevents a drag) but NOT a press-and-drag started
  // inside the toggle or the open panel, which begins on `onPointerDown` —
  // so that needs its own stop too (code review finding). Only the
  // activation/navigation keys are stopped for keydown, not every key: a
  // blanket stop would also swallow the window-level `i` (New Iterate)
  // shortcut while focus sits on the toggle, since React's root-level
  // listener means `stopPropagation()` here defeats the native bubble to
  // `window` as well (code review finding).
  const stopKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " " || ev.key.startsWith("Arrow")) {
      ev.stopPropagation();
    }
  };

  return (
    <div
      data-testid={`task-card-lead-expander-${task.taskId}`}
      className="mt-1"
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stopKey}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`task-card-lead-expander-toggle-${task.taskId}`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)] transition hover:text-[var(--color-text)]"
      >
        {expanded ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
        <span>Lead details</span>
      </button>
      {expanded && (
        <div
          data-testid={`task-card-lead-expander-body-${task.taskId}`}
          className="mt-1 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-button,8px)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5"
        >
          {task.priority && (
            <span
              data-testid={`task-card-lead-priority-${task.taskId}`}
              className={
                "inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                PRIORITY_CLASS[task.priority]
              }
            >
              {task.priority}
            </span>
          )}
          {task.domain && (
            <span
              data-testid={`task-card-lead-domain-${task.taskId}`}
              className="inline-flex items-center rounded-[6px] bg-[var(--color-muted-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]"
            >
              {task.domain}
            </span>
          )}
          {task.complexityHint && (
            <span
              data-testid={`task-card-lead-complexity-${task.taskId}`}
              className="inline-flex items-center rounded-[6px] bg-[var(--color-muted-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)]"
            >
              {task.complexityHint}
            </span>
          )}
          {/* leadOriginId/dedupKey are parsed out of a tag string a daemon
              writes — plain text only. A future iterate wiring these into a
              link or org-page navigation MUST NOT put them in an href/src
              or interpolate them into a style value (unlike the project-
              color `color-mix` string above ProjectPill does for a
              server-validated hex/hsl value, this is untrusted). */}
          {isLeadOriginated(task.tags) && (
            <span
              data-testid={`task-card-lead-origin-${task.taskId}`}
              className="max-w-full break-all text-[10px] text-[var(--color-muted)]"
            >
              Lead: {leadOriginId(task.tags)}
            </span>
          )}
          {isWaitingOnPo(task.tags) && (
            <span
              data-testid={`task-card-lead-wait-${task.taskId}`}
              className="text-[10px] text-[var(--color-muted)]"
            >
              Waiting on PO
            </span>
          )}
          {hasDedupTag(task.tags) && (
            <span
              data-testid={`task-card-lead-dedup-${task.taskId}`}
              className="max-w-full break-all text-[10px] text-[var(--color-muted)]"
            >
              Dedup: {dedupKey(task.tags)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
