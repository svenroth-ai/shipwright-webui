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
 *
 * "Discuss in terminal" / "Take the outcome as the answer" (PO decision
 * 2026-09-07 — no ping-pong: the daemon round-trip is too slow for a real
 * conversation) live in the sibling `InboxCard.LeadQuestion.TerminalDiscuss`
 * component. FR-04.42's round mechanics stay server-side and unused here —
 * this card still sends exactly one answer.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import { MarkdownText } from "../../components/external/MarkdownText";
import { DESCRIPTION_MAX_LENGTH } from "../../components/external/NewIssueModal/SimpleFields";
import { useAnswerLeadQuestion, useDismissInboxItem } from "../../hooks/useExternalInbox";
import type { ExternalTask } from "../../lib/externalApi";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";
import { inboxItemKey, MAX_BODY_PREVIEW_PX } from "./InboxCard";
import { InboxCardShell, InboxEyebrow } from "./InboxCardShell";
import { LeadQuestionTerminalDiscussRow } from "./InboxCard.LeadQuestion.TerminalDiscuss";

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
  const itemKey = inboxItemKey(item);
  const [answerText, setAnswerText] = useState("");
  const answerMutation = useAnswerLeadQuestion();
  const dismissMutation = useDismissInboxItem();

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
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

  return (
    <InboxCardShell
      testId={`inbox-card-${itemKey}`}
      itemKey={itemKey}
      sessionUuid={item.sessionUuid}
      task={task}
      focusTerminal={false}
    >
      <InboxEyebrow>Lead is asking</InboxEyebrow>

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
            data-testid={`inbox-question-fade-${itemKey}`}
            style={{
              position: "absolute",
              insetInline: 0,
              bottom: 0,
              height: "48px",
              background:
                "linear-gradient(to bottom, transparent, var(--inbox-card-bg))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <LeadQuestionTerminalDiscussRow
        taskId={item.taskId}
        itemKey={itemKey}
        onTakeOutcome={() => {
          answerRef.current?.focus();
          answerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        }}
      />

      <textarea
        ref={answerRef}
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
          className="inline-flex items-center rounded-[var(--radius-button)] pointer-coarse:min-h-[44px] font-medium"
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
          className="inline-flex items-center rounded-[var(--radius-button)] pointer-coarse:min-h-[44px] font-medium"
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
    </InboxCardShell>
  );
}
