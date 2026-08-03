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
 * preference is "do I want to see briefs at all"). Default: collapsed —
 * the header stays compact; the user opts in to seeing briefs and the
 * choice then persists.
 *
 * The description is rendered as a plain text node — React escapes it; no
 * `dangerouslySetInnerHTML`. `whitespace-pre-wrap` keeps authored line
 * breaks; `max-height` + scroll stops a very long brief from pushing the
 * 3-pane body off-screen (external review).
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import type { ExternalTask } from "../../lib/externalApi";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useIsPhoneViewport } from "../../hooks/useIsCompactViewport";
import { useRef } from "react";

/** Global (not per-task) collapse preference. */
const COLLAPSE_KEY = "webui:task-description-collapsed";

interface Props {
  task: ExternalTask;
}

export function TaskDescriptionDisclosure({ task }: Props) {
  const isPhone = useIsPhoneViewport();
  const phoneTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    COLLAPSE_KEY,
    true,
  );
  const description = task.description?.trim() ?? "";
  if (description.length === 0) return null;

  if (isPhone) {
    return (
      <div data-testid="task-description-disclosure" className="inline-flex">
        <Popover.Root modal>
          <Popover.Trigger asChild>
            <button
              ref={phoneTriggerRef}
              type="button"
              data-testid="task-description-toggle"
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/20 px-2 text-[11px] font-semibold text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:min-h-9"
            >
              <ChevronRight size={12} aria-hidden="true" />
              <span>Description</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                phoneTriggerRef.current?.focus({ preventScroll: true });
              }}
              className="z-50 w-[min(92vw,32rem)] rounded-xl border border-[var(--line)] bg-white p-4 shadow-xl"
            >
              <div
                data-testid="task-description-body"
                className="max-h-[min(70vh,24rem)] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-[var(--ink)]"
              >
                {description}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  }

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
