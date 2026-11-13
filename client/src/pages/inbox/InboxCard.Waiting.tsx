/*
 * WaitingReplyCard — read-only "awaiting your reply" card (C7 — 2026-05-26;
 * re-skinned into the Triage dark-glass look 2026-11-13).
 *
 * Handles four inbox kinds with identical chrome (InboxCardShell: project-colour
 * bar, context pill, session chip, whole-card click-through; NO dismiss):
 *   - `text_question`   — Claude prose, rendered through XSS-safe
 *     <MarkdownText> (iterate 2026-05-19-inbox-markdown-render).
 *   - `terminal_prompt` — escaped plain-text picker (iterate-2026-05-18).
 *   - `phase_gate`      — the pipeline's approval gate, same picker body.
 *   - `codex_approval`  — escaped plain-text Codex approval dialog (Codex
 *     Light §5.3) — same "operator answers in the terminal" semantics.
 *
 * Body is `pre-wrap` for picker layout; line-clamped via a fixed-height
 * preview with a soft bottom fade when overflowing (the fade runs to the
 * card's own glass colour, `--inbox-card-bg`).
 */
import { useLayoutEffect, useRef, useState } from "react";

import { MarkdownText } from "../../components/external/MarkdownText";
import type {
  CodexApprovalInboxItem,
  ExternalTask,
  PhaseGateInboxItem,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
} from "../../lib/externalApi";
import { InboxCardShell, InboxEyebrow } from "./InboxCardShell";
import { InboxResumeButton } from "./InboxResumeButton";
import { InboxTerminalHonesty, MAX_BODY_PREVIEW_PX } from "./InboxCard";

export function WaitingReplyCard({
  item,
  task,
}: {
  item:
    | TextQuestionInboxItem
    | TerminalPromptInboxItem
    | PhaseGateInboxItem
    | CodexApprovalInboxItem;
  task: ExternalTask | undefined;
}) {
  const itemKey =
    item.kind === "text_question"
      ? item.questionId
      : item.kind === "codex_approval"
        ? `ca-${item.taskId}`
        : item.kind === "phase_gate"
          ? `pg-${item.taskId}`
          : `tp-${item.taskId}`;
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

  return (
    <InboxCardShell
      testId={`inbox-card-${itemKey}`}
      itemKey={itemKey}
      sessionUuid={item.sessionUuid}
      task={task}
    >
      <InboxEyebrow>Awaiting your reply</InboxEyebrow>

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
          // panel (prototype promptCard anatomy), darker than the glass.
          <div
            className="font-mono"
            style={{
              fontSize: "12.5px",
              color: "rgba(255, 255, 255, 0.92)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
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

      {task && (
        <div className="flex items-center justify-end" style={{ marginTop: "12px" }}>
          <InboxResumeButton task={task} idKey={itemKey} />
        </div>
      )}
      <InboxTerminalHonesty itemKey={itemKey} align={task ? "right" : "left"} />
    </InboxCardShell>
  );
}
