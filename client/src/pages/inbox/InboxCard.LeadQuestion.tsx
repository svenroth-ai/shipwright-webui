/*
 * LeadAnswerPanel — FR-04.19's answer form for a `lead_question` item, shown in
 * the Inbox detail dialog (the row itself is a compact Triage row since
 * iterate-2026-11-22-w2-inbox-triage-look; the form moved here unchanged).
 *
 * Unlike the terminal-answered kinds (the PO answers Claude in the task's own
 * terminal), this DOES answer for the PO: a lead_question is leadwright's own
 * follow-up, not a live Claude turn, so there is no terminal to type into.
 * Submitting PATCHes the task's `poFeedback` (FR-04.17) and Dismiss suppresses
 * the entry without answering (server-side: `dismissedToolUseIds` keyed
 * `lq-<taskId>`).
 *
 * "Discuss in terminal" / "Take the outcome as the answer" (PO decision
 * 2026-09-07 — no ping-pong: the daemon round-trip is too slow for a real
 * conversation) live in the sibling `InboxCard.LeadQuestion.TerminalDiscuss`
 * component. FR-04.42's round mechanics stay server-side and unused here —
 * this panel still sends exactly one answer.
 *
 * It sits on the LIGHT dialog sheet, so it reads the global light tokens.
 */
import { useRef, useState, type MouseEvent } from "react";

import { DESCRIPTION_MAX_LENGTH } from "../../components/external/NewIssueModal/SimpleFields";
import { useAnswerLeadQuestion, useDismissInboxItem } from "../../hooks/useExternalInbox";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";
import { LeadQuestionTerminalDiscussRow } from "./InboxCard.LeadQuestion.TerminalDiscuss";

// The answer marker (`answerLeadQuestion`) appends ~40 chars to the typed
// text before it is checked against the server's own DESCRIPTION_MAX_LENGTH
// cap on `poFeedback` (server/src/external/_shared/helpers.ts) — leave room.
const ANSWER_MAX_LENGTH = DESCRIPTION_MAX_LENGTH - 100;

export function LeadAnswerPanel({
  item,
  itemKey,
}: {
  item: LeadQuestionInboxItem;
  itemKey: string;
}) {
  const [answerText, setAnswerText] = useState("");
  const answerMutation = useAnswerLeadQuestion();
  const dismissMutation = useDismissInboxItem();
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

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
    <div data-testid={`inbox-lead-panel-${itemKey}`}>
      <LeadQuestionTerminalDiscussRow
        taskId={item.taskId}
        itemKey={itemKey}
        onTakeOutcome={() => {
          answerRef.current?.focus();
          answerRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        }}
      />

      <textarea
        ref={answerRef}
        data-testid={`inbox-lead-answer-input-${itemKey}`}
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        aria-label="Your answer to the lead"
        placeholder="Type your answer…"
        rows={3}
        maxLength={ANSWER_MAX_LENGTH}
        className="mt-3 w-full resize-y rounded-[8px] border border-[var(--color-border)] bg-white px-2.5 py-2 text-[13px] text-[var(--color-text)]"
        style={{ fontFamily: "inherit" }}
      />

      {answerMutation.isError && (
        <p
          role="alert"
          data-testid={`inbox-lead-answer-error-${itemKey}`}
          className="mt-1.5 text-xs text-err"
        >
          Couldn't send your answer — {answerMutation.error.message}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          data-testid={`inbox-lead-dismiss-${itemKey}`}
          onClick={handleDismiss}
          disabled={dismissMutation.isPending}
          className="inline-flex items-center rounded-[var(--radius-button)] border border-[var(--color-border)] bg-transparent px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-muted)] pointer-coarse:min-h-[44px]"
        >
          Dismiss
        </button>
        <button
          type="button"
          data-testid={`inbox-lead-answer-send-${itemKey}`}
          onClick={handleSend}
          disabled={!answerText.trim() || answerMutation.isPending}
          className="btn-primary"
        >
          {answerMutation.isPending ? "Sending…" : "Send answer"}
        </button>
      </div>
    </div>
  );
}
