/*
 * AskToolCard — read-only Ask-bubble at Inbox density (C7 — 2026-05-26).
 *
 * Extracted from InboxPage.tsx lines 453-655 (lifted verbatim).
 *
 * Shape (3.7d-b3):
 *   ┌──┬───────────────────────────────────────────────────┐
 *   │▐▌│ [pill] build · task-title          2h ago          │
 *   │▐▌│ PRIORITY                                           │
 *   │▐▌│ question body (14-15px / 600)                      │
 *   │▐▌│ [chip: JWT] [chip: Session]                        │
 *   │▐▌│                                  [Answer] ←brown   │
 *   └──┴───────────────────────────────────────────────────┘
 *    ^3px amber left strip; card keeps --color-surface bg.
 *
 * Whole-card click → /tasks/<taskId>. Resume button stops propagation.
 */
import { useMemo, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { extractAskUserPayload } from "../../lib/askUserPayload";
import { classifyPhase } from "../../lib/classifyPhase";
import { formatRelativeTime } from "../../lib/formatTime";
import type { AskToolInboxItem, ExternalTask } from "../../lib/externalApi";
import { InboxResumeButton } from "./InboxResumeButton";
import { InboxTerminalHonesty, KNOWN_PHASES, PHASE_ICON } from "./InboxCard";

export function AskToolCard({
  item,
  task,
}: {
  item: AskToolInboxItem;
  task: ExternalTask | undefined;
}) {
  const navigate = useNavigate();
  const isAUQ = item.toolName === "AskUserQuestion";
  const payload = isAUQ ? extractAskUserPayload(item.input) : null;
  const firstPart = payload?.parts[0];
  const fallback = isAUQ && (!firstPart || !firstPart.question.trim());

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
        borderLeft: "3px solid var(--color-warning)",
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
      data-testid={`inbox-card-${item.toolUseId}`}
      data-testid-legacy={`inbox-item-${item.toolUseId}`}
    >
      <span
        data-testid={`inbox-item-${item.toolUseId}`}
        style={{ display: "none" }}
        aria-hidden="true"
      />
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
              data-testid={`inbox-task-context-pill-${item.toolUseId}`}
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

      {firstPart && !fallback ? (
        <div>
          {firstPart.header && (
            <div
              className="font-semibold uppercase"
              style={{
                fontSize: "11px",
                letterSpacing: "0.6px",
                color: "var(--color-muted)",
                marginBottom: "6px",
              }}
            >
              {firstPart.header}
            </div>
          )}
          <div
            className="font-semibold"
            style={{
              fontSize: "15px",
              color: "var(--color-text)",
              lineHeight: 1.45,
              marginBottom: firstPart.context ? "8px" : "14px",
            }}
          >
            {firstPart.question}
          </div>

          {firstPart.context && (
            <div
              style={{
                fontSize: "13px",
                color: "var(--color-muted)",
                lineHeight: 1.5,
                marginBottom: "14px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {firstPart.context}
            </div>
          )}

          {firstPart.options && firstPart.options.length > 0 && (
            <div
              className="flex flex-wrap items-center"
              style={{ gap: "8px", marginBottom: "16px" }}
            >
              {firstPart.options.map((o, i) => (
                <span
                  key={i}
                  data-testid={`inbox-option-chip-${i}`}
                  className="inline-flex items-center rounded-[var(--radius-button)] font-medium"
                  style={{
                    padding: "6px 14px",
                    border: "1px solid var(--color-border)",
                    fontSize: "13px",
                    color: "var(--color-text)",
                    background: "var(--color-muted-bg)",
                  }}
                >
                  {o}
                </span>
              ))}
            </div>
          )}

          {task && (
            <div className="flex items-center justify-end" style={{ marginTop: "4px" }}>
              <InboxResumeButton task={task} idKey={item.toolUseId} />
            </div>
          )}
          <InboxTerminalHonesty itemKey={item.toolUseId} align="right" />
        </div>
      ) : (
        <div>
          <div
            className="italic"
            style={{
              fontSize: "12px",
              color: "var(--color-muted)",
              marginBottom: "8px",
            }}
          >
            Question payload schema differed from expected — open the task in
            your terminal to see the original.
          </div>
          {task && (
            <div className="flex items-center justify-end" style={{ marginTop: "4px" }}>
              <InboxResumeButton task={task} idKey={item.toolUseId} />
            </div>
          )}
          <InboxTerminalHonesty itemKey={item.toolUseId} align="right" />
        </div>
      )}
    </div>
  );
}
