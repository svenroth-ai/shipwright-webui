/*
 * CodexNoticeCard — Codex Light AC6/§5.3's informational Inbox cards.
 *
 * Handles two inbox kinds, both FYI-only (no reply required, no Answer/
 * Dismiss action — the underlying condition auto-clears the notice the
 * next time the aggregator runs, same "ephemeral" character as
 * `terminal_prompt`):
 *   - `codex_watcher` — a `CodexTaskWatcher` notice (nudge sent, delivery
 *     error, unresolved no_oracle self-check, failed launch confirmation).
 *   - `codex_error`   — a Codex-reported structured error (turn abort,
 *     rate limit, etc.) detected in the live terminal.
 *
 * Same chrome family as the sibling cards (left strip, context pill,
 * time-ago, click-through to the task) so the Inbox reads as one system —
 * `codex_error` uses the danger strip color since it names a real failure,
 * `codex_watcher` keeps the shared warning strip other FYI cards use.
 */
import { useMemo, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { classifyPhase } from "../../lib/classifyPhase";
import { formatRelativeTime } from "../../lib/formatTime";
import type {
  CodexErrorInboxItem,
  CodexWatcherInboxItem,
  ExternalTask,
} from "../../lib/externalApi";
import { KNOWN_PHASES, PHASE_ICON } from "./InboxCard";

const NOTICE_KIND_LABEL: Record<CodexWatcherInboxItem["noticeKind"], string> = {
  nudge_sent: "Nudge sent",
  delivery_error: "Delivery failed",
  no_oracle_unresolved: "Needs a status check",
  launch_confirmation_failed: "Launch may have failed",
};

export function CodexNoticeCard({
  item,
  task,
}: {
  item: CodexWatcherInboxItem | CodexErrorInboxItem;
  task: ExternalTask | undefined;
}) {
  const navigate = useNavigate();
  const itemKey = item.kind === "codex_watcher" ? `cw-${item.taskId}` : `ce-${item.taskId}`;
  const bodyText = item.kind === "codex_watcher" ? item.detail : item.errorText;
  const label =
    item.kind === "codex_watcher" ? NOTICE_KIND_LABEL[item.noticeKind] : "Codex error";
  const isError = item.kind === "codex_error" || item.noticeKind === "delivery_error";

  const phase = useMemo<string | null>(() => {
    if (!task?.title) return null;
    return classifyPhase(task.title, KNOWN_PHASES as unknown as string[]);
  }, [task?.title]);

  const timeAgo = useMemo<string | null>(() => {
    const stamp = task?.launchedAt ?? task?.createdAt;
    return stamp ? formatRelativeTime(stamp) : null;
  }, [task?.launchedAt, task?.createdAt]);

  const handleCardClick = () => {
    if (!task) return;
    navigate(`/tasks/${task.taskId}`, { state: { focusTerminal: true } });
  };
  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!task) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      navigate(`/tasks/${task.taskId}`, { state: { focusTerminal: true } });
    }
  };

  const PhaseIcon = phase ? PHASE_ICON[phase] : null;

  return (
    <div
      className="transition-opacity"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderLeft: `3px solid ${isError ? "var(--color-danger, #c0392b)" : "var(--color-warning)"}`,
        borderRadius: "var(--radius-button)",
        padding: "12px 24px 20px",
        boxShadow: "var(--shadow-sm)",
        maxWidth: "720px",
        cursor: task ? "pointer" : "default",
      }}
      role={task ? "button" : undefined}
      tabIndex={task ? 0 : undefined}
      aria-label={task ? `Open task ${task.title}` : undefined}
      onClick={task ? handleCardClick : undefined}
      onKeyDown={task ? handleCardKeyDown : undefined}
      data-nav-item={task ? "" : undefined}
      data-testid={`inbox-card-${itemKey}`}
    >
      <div className="mb-[6px] flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {phase && PhaseIcon && task && (
            <span
              className="inline-flex items-center gap-[5px] rounded-[12px] font-semibold uppercase"
              style={{
                background: "var(--color-muted-bg)",
                color: "var(--color-muted)",
                fontSize: "11px",
                padding: "3px 10px",
                letterSpacing: "0.02em",
              }}
              data-testid={`inbox-task-context-pill-${itemKey}`}
            >
              <PhaseIcon size={12} />
              <span className="truncate">
                {phase} / {task.title}
              </span>
            </span>
          )}
        </div>
        {timeAgo && (
          <span
            className="shrink-0 text-[12px] font-normal"
            style={{ color: "var(--color-muted)" }}
          >
            {timeAgo}
          </span>
        )}
      </div>

      <div
        className="font-semibold uppercase"
        style={{
          fontSize: "11px",
          letterSpacing: "0.6px",
          color: isError ? "var(--color-danger, #c0392b)" : "var(--color-muted)",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>

      <div
        data-testid={`inbox-question-text-${itemKey}`}
        style={{
          fontSize: "13px",
          color: "var(--color-text)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {bodyText}
      </div>
    </div>
  );
}
