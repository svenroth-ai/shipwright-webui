/*
 * InboxResumeButton — the "Answer in the terminal" CTA for an Inbox entry.
 *
 * A19 (FR-01.63): this used to COPY a resume command to the clipboard (a
 * leftover from the pre-embedded-terminal era). The task now HAS an embedded
 * terminal, and that is where the answer gets typed — by the operator, not the
 * WebUI. So the CTA NAVIGATES to the task's terminal (deep link built in
 * lib/taskDeepLink.ts), focused and ready. It writes NOTHING: no clipboard, no
 * pty frame, no answer injection. The fence is proven by
 * inbox-no-writepath.test.ts.
 *
 * Two looks, one behaviour: `row` is the compact Triage action button shown on
 * hover / focus in a row (dark surface); `dialog` is the standard primary button
 * on the light detail sheet. Stops click/keydown propagation so a containing
 * clickable row doesn't also open its dialog.
 */
import { type KeyboardEvent, type MouseEvent } from "react";
import { Terminal } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { ExternalTask } from "../../lib/externalApi";
import { buildTaskTerminalDeepLink } from "../../lib/taskDeepLink";

/* Row look = the Triage primary action button (dark surface only). */
const ROW_BTN =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--color-primary)] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] pointer-coarse:min-h-[44px]";

export function InboxResumeButton({
  task,
  idKey,
  variant = "row",
}: {
  task: ExternalTask;
  /** Stable item key — the ask_tool toolUseId, or the item key. */
  idKey: string;
  variant?: "row" | "dialog";
}) {
  const navigate = useNavigate();

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    navigate(buildTaskTerminalDeepLink(task.taskId));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        // Native button activation still fires onClick; Enter/Space must not bubble to the row.
        e.stopPropagation();
      }}
      data-testid={`inbox-resume-${idKey}`}
      className={variant === "dialog" ? "btn-primary" : ROW_BTN}
    >
      <Terminal size={14} aria-hidden="true" />
      Answer in the terminal
    </button>
  );
}
