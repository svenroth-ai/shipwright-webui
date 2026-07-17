/*
 * WaitingReplyCard — read-only "awaiting your reply" card (C7 — 2026-05-26).
 *
 * Extracted from InboxPage.tsx lines 672-846 (lifted verbatim).
 *
 * Handles two inbox kinds with identical chrome (amber left strip, context
 * pill, time-ago, whole-card click-through; NO Answer button, NO dismiss):
 *   - `text_question`   — Claude prose, rendered through XSS-safe
 *     <MarkdownText> (iterate 2026-05-19-inbox-markdown-render).
 *   - `terminal_prompt` — escaped plain-text picker (iterate-2026-05-18).
 *
 * Body is `pre-wrap` for picker layout; line-clamped via a fixed-height
 * preview with a soft bottom fade when overflowing.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { MarkdownText } from "../../components/external/MarkdownText";
import { classifyPhase } from "../../lib/classifyPhase";
import { formatRelativeTime } from "../../lib/formatTime";
import type {
  ExternalTask,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
} from "../../lib/externalApi";
import { InboxResumeButton } from "./InboxResumeButton";
import {
  InboxTerminalHonesty,
  KNOWN_PHASES,
  MAX_BODY_PREVIEW_PX,
  PHASE_ICON,
} from "./InboxCard";

export function WaitingReplyCard({
  item,
  task,
}: {
  item: TextQuestionInboxItem | TerminalPromptInboxItem;
  task: ExternalTask | undefined;
}) {
  const navigate = useNavigate();
  const itemKey =
    item.kind === "text_question" ? item.questionId : `tp-${item.taskId}`;
  const bodyText =
    item.kind === "text_question" ? item.questionText : item.promptText;
  const isMarkdown = item.kind === "text_question";

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      setOverflowing(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bodyText]);

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
          color: "var(--color-muted)",
          marginBottom: "6px",
        }}
      >
        Awaiting your reply
      </div>

      <div
        ref={bodyRef}
        data-testid={`inbox-question-text-${itemKey}`}
        style={{
          position: "relative",
          maxHeight: `${MAX_BODY_PREVIEW_PX}px`,
          overflow: "hidden",
        }}
      >
        {isMarkdown ? (
          <MarkdownText text={bodyText} />
        ) : (
          // terminal_prompt: a live xterm picker → keep it in a recessed MONO
          // panel (prototype promptCard anatomy). Frozen --color-* tokens so the
          // panel stays dark-on-inset regardless of the .on-photo flip.
          <div
            className="font-mono"
            style={{
              fontSize: "12.5px",
              color: "var(--color-text)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              background: "var(--color-muted-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "10px 13px",
            }}
          >
            {bodyText}
          </div>
        )}
        {overflowing && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              insetInline: 0,
              bottom: 0,
              height: "48px",
              background:
                "linear-gradient(to bottom, transparent, var(--color-surface))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {task && (
        <div className="flex items-center justify-end" style={{ marginTop: "12px" }}>
          <InboxResumeButton task={task} idKey={itemKey} />
        </div>
      )}
      <InboxTerminalHonesty itemKey={itemKey} align={task ? "right" : "left"} />
    </div>
  );
}
