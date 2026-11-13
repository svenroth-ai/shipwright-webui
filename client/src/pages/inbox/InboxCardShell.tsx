/*
 * InboxCardShell — the ONE chrome every Inbox card shares
 * (iterate-2026-11-13-inbox-triage-look). It used to be copy-pasted into four
 * card files; now the dark-glass frame, the project-colour bar, the context
 * pill, the session chip + age and the whole-card click-through live here, and
 * each card variant only supplies its own body. The look is in
 * styles/inbox-cards.css; the project colour arrives as `--acc` from the
 * enclosing project group (an error card overrides it to the error colour).
 *
 * Whole-card click → /tasks/<taskId> (optionally focusing the terminal).
 * The card ignores Enter/Space that bubbled up from a nested control (a button,
 * textarea or markdown link inside it), so pressing it never also navigates.
 */
import { useMemo, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { classifyPhase } from "../../lib/classifyPhase";
import { formatRelativeTime } from "../../lib/formatTime";
import type { ExternalTask } from "../../lib/externalApi";
import { KNOWN_PHASES, PHASE_ICON } from "./phaseMeta";

interface Props {
  /** `inbox-card-<key>` — the load-bearing card testid. */
  testId: string;
  /** Stable item key, used to make the session chip's testid unique per card. */
  itemKey: string;
  sessionUuid: string;
  task: ExternalTask | undefined;
  /** `err` paints the bar + eyebrow in the error colour (a real failure). */
  tone?: "warn" | "err";
  /** Navigate with `focusTerminal` so the task page lands in the terminal. */
  focusTerminal?: boolean;
  /** Extra attribute some specs still read (`data-testid-legacy`). */
  legacyTestId?: string;
  children: ReactNode;
}

export function InboxCardShell({
  testId,
  itemKey,
  sessionUuid,
  task,
  tone = "warn",
  focusTerminal = true,
  legacyTestId,
  children,
}: Props) {
  const navigate = useNavigate();

  const phase = useMemo<string | null>(() => {
    if (!task?.title) return null;
    return classifyPhase(task.title, KNOWN_PHASES as unknown as string[]);
  }, [task?.title]);

  const timeAgo = useMemo<string | null>(() => {
    const stamp = task?.launchedAt ?? task?.createdAt;
    return stamp ? formatRelativeTime(stamp) : null;
  }, [task?.launchedAt, task?.createdAt]);

  const go = () => {
    if (!task) return;
    navigate(`/tasks/${task.taskId}`, focusTerminal ? { state: { focusTerminal: true } } : undefined);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!task) return;
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      go();
    }
  };

  const PhaseIcon = phase ? PHASE_ICON[phase] : null;

  return (
    <div
      className={`inbox-card${tone === "err" ? " is-err" : ""}`}
      role={task ? "button" : undefined}
      tabIndex={task ? 0 : undefined}
      aria-label={task ? `Open task ${task.title}` : undefined}
      onClick={task ? go : undefined}
      onKeyDown={task ? onKeyDown : undefined}
      data-nav-item={task ? "" : undefined}
      data-testid={testId}
      data-testid-legacy={legacyTestId}
    >
      <div className="inbox-card-bar" aria-hidden="true" />
      <div className="inbox-card-in">
        <div className="inbox-card-top">
          <div className="flex min-w-0 items-center gap-2">
            {phase && PhaseIcon && task && (
              <span
                className="inbox-card-pill"
                data-testid={`inbox-task-context-pill-${itemKey}`}
              >
                <PhaseIcon size={12} />
                <span className="truncate">
                  {phase} / {task.title}
                </span>
              </span>
            )}
          </div>
          <div className="inbox-card-meta">
            <span
              className="inbox-card-id"
              title={`Session ${sessionUuid}`}
              data-testid={`inbox-group-project-label-${sessionUuid}-${itemKey}`}
            >
              {sessionUuid.slice(0, 8)}
            </span>
            {timeAgo && <span className="inbox-card-ago">{timeAgo}</span>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The small status line above a card body: an amber dot (needs you) or red (failure). */
export function InboxEyebrow({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "err";
  children: ReactNode;
}) {
  return (
    <div className={`inbox-card-eyebrow${tone === "err" ? " is-err" : ""}`}>{children}</div>
  );
}
