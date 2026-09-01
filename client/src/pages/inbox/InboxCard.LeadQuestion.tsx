/*
 * LeadQuestionCard — FR-04.19's inbox card for a `lead_question` item.
 *
 * Unlike `AskToolCard`/`WaitingReplyCard` (which only disclaim — the PO
 * answers Claude in the task's own terminal), this card DOES answer for
 * the PO: a lead_question is leadwright's own follow-up, not a live Claude
 * turn, so there is no terminal to type into. Submitting PATCHes the
 * task's `poFeedback` (FR-04.17) and Dismiss suppresses the card without
 * answering (server-side: `dismissedToolUseIds` keyed `lq-<taskId>`).
 *
 * Same chrome family as the sibling cards (amber left strip, context pill,
 * time-ago, click-through to the task) so the Inbox reads as one system.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import { MarkdownText } from "../../components/external/MarkdownText";
import { DESCRIPTION_MAX_LENGTH } from "../../components/external/NewIssueModal/SimpleFields";
import { classifyPhase } from "../../lib/classifyPhase";
import { formatRelativeTime } from "../../lib/formatTime";
import { useAnswerLeadQuestion, useDismissInboxItem } from "../../hooks/useExternalInbox";
import type { ExternalTask } from "../../lib/externalApi";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";
import { inboxItemKey, KNOWN_PHASES, MAX_BODY_PREVIEW_PX, PHASE_ICON } from "./InboxCard";

// The answer marker (`answerLeadQuestion`) appends ~40 chars to the typed
// text before it is checked against the server's own DESCRIPTION_MAX_LENGTH
// cap on `poFeedback` (server/src/external/_shared/helpers.ts) — leave room.
const ANSWER_MAX_LENGTH = DESCRIPTION_MAX_LENGTH - 100;

export function LeadQuestionCard({
  item,
  task,
}: {
  item: LeadQuestionInboxItem;
  task: ExternalTask | undefined;
}) {
  const navigate = useNavigate();
  const itemKey = inboxItemKey(item);
  const [answerText, setAnswerText] = useState("");
  const answerMutation = useAnswerLeadQuestion();
  const dismissMutation = useDismissInboxItem();

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
  }, [item.questionText]);

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
    navigate(`/tasks/${task.taskId}`);
  };
  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!task) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      navigate(`/tasks/${task.taskId}`);
    }
  };

  const handleSend = (e: MouseEvent) => {
    e.stopPropagation();
    if (!answerText.trim() || answerMutation.isPending) return;
    answerMutation.mutate(
      { taskId: item.taskId, answerText },
      { onSuccess: () => setAnswerText("") },
    );
  };

  const handleDismiss = (e: MouseEvent) => {
    e.stopPropagation();
    if (dismissMutation.isPending) return;
    dismissMutation.mutate(itemKey);
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
        Lead is asking
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
        <MarkdownText text={item.questionText} />
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

      <textarea
        data-testid={`inbox-lead-answer-input-${itemKey}`}
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="Type your answer…"
        rows={3}
        maxLength={ANSWER_MAX_LENGTH}
        style={{
          width: "100%",
          marginTop: "12px",
          padding: "8px 10px",
          fontSize: "13px",
          fontFamily: "inherit",
          color: "var(--color-text)",
          background: "var(--color-muted-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "8px",
          resize: "vertical",
        }}
      />

      {answerMutation.isError && (
        <p
          role="alert"
          data-testid={`inbox-lead-answer-error-${itemKey}`}
          style={{
            marginTop: "6px",
            fontSize: "12px",
            color: "var(--color-danger, #c0392b)",
          }}
        >
          Couldn't send your answer — {answerMutation.error.message}
        </p>
      )}

      <div
        className="flex items-center justify-end gap-2"
        style={{ marginTop: "10px" }}
      >
        <button
          type="button"
          data-testid={`inbox-lead-dismiss-${itemKey}`}
          onClick={handleDismiss}
          disabled={dismissMutation.isPending}
          className="inline-flex items-center rounded-[var(--radius-button)] font-medium"
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            color: "var(--color-muted)",
            background: "transparent",
            border: "1px solid var(--color-border)",
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          data-testid={`inbox-lead-answer-send-${itemKey}`}
          onClick={handleSend}
          disabled={!answerText.trim() || answerMutation.isPending}
          className="inline-flex items-center rounded-[var(--radius-button)] font-medium"
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            color: "var(--color-on-primary, #fff)",
            background: "var(--btn-primary-bg, var(--color-primary))",
            border: "none",
            opacity: !answerText.trim() || answerMutation.isPending ? 0.6 : 1,
          }}
        >
          {answerMutation.isPending ? "Sending…" : "Send answer"}
        </button>
      </div>
    </div>
  );
}
