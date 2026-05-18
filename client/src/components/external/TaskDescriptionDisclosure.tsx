/*
 * TaskDescriptionDisclosure — collapsible, read-only view of a task's
 * description (the brief / initial prompt). Rendered in TaskDetailHeader
 * under the title row so the brief is visible once a task is In Progress
 * (and at every other state too). iterate-2026-05-18-edit-task-dialog.
 *
 * Renders nothing when the task has no description.
 *
 * The collapse state is a single global UI-density preference — one
 * localStorage key, like the Transcript/Terminal tab pref — NOT keyed per
 * task (avoids unbounded localStorage growth; the brief is short and the
 * preference is "do I want to see briefs at all"). Default: expanded.
 *
 * The description is rendered as a plain text node — React escapes it; no
 * `dangerouslySetInnerHTML`. `whitespace-pre-wrap` keeps authored line
 * breaks; `max-height` + scroll stops a very long brief from pushing the
 * 3-pane body off-screen (external review).
 */
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import { useLocalStorage } from "../../hooks/useLocalStorage";

/** Global (not per-task) collapse preference. */
const COLLAPSE_KEY = "webui:task-description-collapsed";

interface Props {
  task: ExternalTask;
}

export function TaskDescriptionDisclosure({ task }: Props) {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    COLLAPSE_KEY,
    false,
  );
  const description = task.description?.trim() ?? "";
  if (description.length === 0) return null;

  return (
    <div data-testid="task-description-disclosure" className="mt-0.5">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        data-testid="task-description-toggle"
        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted,#6b7280)] transition hover:text-[var(--color-text,#1a1a1a)]"
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" />
        )}
        <span>Description</span>
      </button>
      {!collapsed && (
        <div
          data-testid="task-description-body"
          className="mt-1 max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-2.5 py-1.5 text-[12px] leading-[1.5] text-[var(--color-text,#1a1a1a)]"
        >
          {description}
        </div>
      )}
    </div>
  );
}
