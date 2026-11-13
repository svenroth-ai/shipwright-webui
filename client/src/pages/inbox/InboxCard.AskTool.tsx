/*
 * AskToolCard — read-only Ask-bubble at Inbox density (C7 — 2026-05-26;
 * re-skinned into the Triage dark-glass look 2026-11-13).
 *
 * Shape:
 *   ┌───────────────────────────────────────────────────────┐ ← 3px project colour
 *   │ [pill] build · task-title         session   2h ago     │
 *   │ ● PRIORITY                                             │
 *   │ question body (15px / 600)                             │
 *   │ [chip: JWT] [chip: Session]                            │
 *   │                              [Answer in the terminal]  │
 *   └───────────────────────────────────────────────────────┘
 *
 * The chrome (frame, pill, session chip, click-through) is InboxCardShell.
 * Whole-card click → /tasks/<taskId>. The CTA stops propagation.
 */
import { extractAskUserPayload } from "../../lib/askUserPayload";
import type { AskToolInboxItem, ExternalTask } from "../../lib/externalApi";
import { InboxCardShell, InboxEyebrow } from "./InboxCardShell";
import { InboxResumeButton } from "./InboxResumeButton";
import { InboxTerminalHonesty } from "./InboxCard";

export function AskToolCard({
  item,
  task,
}: {
  item: AskToolInboxItem;
  task: ExternalTask | undefined;
}) {
  const isAUQ = item.toolName === "AskUserQuestion";
  const payload = isAUQ ? extractAskUserPayload(item.input) : null;
  const firstPart = payload?.parts[0];
  const fallback = isAUQ && (!firstPart || !firstPart.question.trim());

  return (
    <InboxCardShell
      testId={`inbox-card-${item.toolUseId}`}
      legacyTestId={`inbox-item-${item.toolUseId}`}
      itemKey={item.toolUseId}
      sessionUuid={item.sessionUuid}
      task={task}
    >
      <span
        data-testid={`inbox-item-${item.toolUseId}`}
        style={{ display: "none" }}
        aria-hidden="true"
      />

      {firstPart && !fallback ? (
        <div>
          {firstPart.header && <InboxEyebrow>{firstPart.header}</InboxEyebrow>}
          <div
            className="font-semibold"
            style={{
              fontSize: "15px",
              color: "#fff",
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
                  className="inline-flex items-center font-medium"
                  style={{
                    padding: "6px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--color-border)",
                    fontSize: "13px",
                    color: "rgba(255, 255, 255, 0.92)",
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
    </InboxCardShell>
  );
}
