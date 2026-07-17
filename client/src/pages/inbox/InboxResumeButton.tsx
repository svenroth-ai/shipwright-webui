/*
 * InboxResumeButton — the "Answer in the terminal" CTA for an Inbox card.
 *
 * A19 (FR-01.63): this used to COPY a resume command to the clipboard (a
 * leftover from the pre-embedded-terminal era). The task now HAS an embedded
 * terminal, and that is where the answer gets typed — by the operator, not the
 * WebUI. So the CTA now NAVIGATES to the task's terminal (deep link built in
 * lib/taskDeepLink.ts), focused and ready. It writes NOTHING: no clipboard, no
 * pty frame, no answer injection. The fence is proven by
 * inbox-no-writepath.test.ts.
 *
 * Stops click/keydown propagation so the containing clickable card doesn't also
 * navigate (the card carries its own in-app focusTerminal nav-state).
 */
import { type KeyboardEvent, type MouseEvent } from "react";
import { Terminal } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { ExternalTask } from "../../lib/externalApi";
import { buildTaskTerminalDeepLink } from "../../lib/taskDeepLink";

export function InboxResumeButton({
  task,
  idKey,
}: {
  task: ExternalTask;
  /** Stable item key — the ask_tool toolUseId, or the waiting-card itemKey. */
  idKey: string;
}) {
  const navigate = useNavigate();
  const goToTerminal = () => navigate(buildTaskTerminalDeepLink(task.taskId));

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Prevent the card-level onClick from also firing.
    e.stopPropagation();
    goToTerminal();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        // Don't let Enter/Space bubble to the card's keydown handler (native
        // button activation still fires onClick, which navigates).
        e.stopPropagation();
      }}
      data-testid={`inbox-resume-${idKey}`}
      className="inline-flex items-center gap-2 rounded-[var(--radius-button)] font-semibold text-white shadow-sm transition-colors"
      style={{
        background: "var(--color-primary)",
        padding: "8px 16px",
        fontSize: "13px",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--color-primary-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--color-primary)";
      }}
      aria-label="Open the task's terminal to answer"
    >
      <Terminal size={14} />
      Answer in the terminal
    </button>
  );
}
