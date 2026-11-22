/*
 * The honesty line (A19, FR-01.63, AC4). A terminal-answered entry states
 * plainly that the operator answers in the terminal and the WebUI does NOT
 * answer for them — so nobody is left guessing whether a click "sent" their
 * reply. The copy is a REQUIREMENT (asserted in a test), not decoration; kept as
 * one canonical string. It now sits in the detail dialog (light sheet). A leaf
 * module so the dialog and InboxCard can both import it without a cycle.
 */
export const INBOX_TERMINAL_HONESTY =
  "Claude is waiting for your answer. Type it in the task's terminal — the WebUI doesn't answer for you.";

export function InboxTerminalHonesty({ itemKey }: { itemKey: string }) {
  return (
    <p
      data-testid={`inbox-honesty-${itemKey}`}
      className="mb-0 mt-3 text-xs leading-relaxed text-[var(--color-muted)]"
    >
      {INBOX_TERMINAL_HONESTY}
    </p>
  );
}
