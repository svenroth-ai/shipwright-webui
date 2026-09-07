/*
 * LeadQuestionTerminalDiscussRow — the "no ping-pong" escape hatch (PO
 * decision 2026-09-07) for `InboxCard.LeadQuestion.tsx`. Split out to keep
 * the parent file under the 300-line convention.
 *
 * "Discuss in terminal" opens a FRESH terminal session on the card's task
 * via the existing `POST /api/terminal/:taskId/spawn` prewarm, then
 * navigates there the same way the rest of the app does — no new route.
 * That session is NOT the lead: no charter, no context packet, no
 * authority bands, so the caveat text below the button is load-bearing,
 * not decorative. "Take the outcome as the answer" is the way back: it
 * asks the parent to focus the card's answer field so whatever was
 * settled in the terminal still reaches the lead through the one existing
 * answer path — this row never presents the exchange as an ongoing thread.
 */
import { type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Terminal as TerminalIcon } from "lucide-react";

/**
 * Best-effort prewarm of the embedded terminal pty (mirrors
 * `LaunchCTA`/`ResumeCTA`'s `prewarmPty` — the WS upgrade is the
 * authoritative pty creation path; `/spawn` only shaves the latency of the
 * first connect). Failure is non-fatal: we still navigate, since the WS
 * upgrade will create the pty anyway.
 */
async function prewarmPty(taskId: string): Promise<void> {
  try {
    await fetch(`/api/terminal/${encodeURIComponent(taskId)}/spawn`, {
      method: "POST",
    });
  } catch {
    // Non-fatal — WS upgrade on the task page creates the pty either way.
  }
}

export function LeadQuestionTerminalDiscussRow({
  taskId,
  itemKey,
  onTakeOutcome,
}: {
  taskId: string;
  itemKey: string;
  /** Focuses (and scrolls to) the parent card's answer textarea. */
  onTakeOutcome: () => void;
}) {
  const navigate = useNavigate();

  const handleDiscuss = (e: MouseEvent) => {
    e.stopPropagation();
    void prewarmPty(taskId);
    navigate(`/tasks/${taskId}`);
  };

  const handleTakeOutcome = (e: MouseEvent) => {
    e.stopPropagation();
    onTakeOutcome();
  };

  return (
    <div style={{ marginTop: "10px" }}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`inbox-lead-discuss-terminal-${itemKey}`}
          onClick={handleDiscuss}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] font-medium"
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            color: "var(--color-text)",
            background: "var(--color-muted-bg)",
            border: "1px solid var(--color-border)",
          }}
        >
          <TerminalIcon size={13} />
          Discuss in terminal
        </button>
        <button
          type="button"
          data-testid={`inbox-lead-take-outcome-${itemKey}`}
          onClick={handleTakeOutcome}
          className="inline-flex items-center rounded-[var(--radius-button)] font-medium"
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            color: "var(--color-muted)",
            background: "transparent",
            border: "1px solid var(--color-border)",
          }}
        >
          Take the outcome as the answer
        </button>
      </div>
      <p
        data-testid={`inbox-lead-terminal-caveat-${itemKey}`}
        style={{
          marginTop: "4px",
          fontSize: "11px",
          color: "var(--color-muted)",
        }}
      >
        Opens a fresh Claude session for this task — it isn't the lead and
        won't see this question or thread.
      </p>
    </div>
  );
}
