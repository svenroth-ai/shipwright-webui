/*
 * TerminalPrivacyFooter — compact privacy disclosure for the Terminal tab
 * (ADR-068-A1 AC-15, extended in iterate v0.8.2 AC-8 / AC-9).
 *
 * Extracted verbatim from TaskDetailPage (A11 footprint: the page is
 * grandfathered at 676 LOC and must not grow when the Mission tab is wired in).
 * Behaviour is unchanged — a pure move.
 *
 * Renders as a 1-line dismissible note at the bottom of the embedded terminal
 * pane. The user toggles it off via the × button; preference persists in
 * localStorage. Copy includes:
 *   - retention period (interpolated from server config — AC-9)
 *   - resolved scrollback dir (interpolated from server config — AC-9)
 *   - "may contain secrets" warning
 *   - Windows-permission-best-effort note (when on Windows)
 *   - "Clear history" pointer (route through "..." menu)
 *
 * AC-8: the footer renders only when the server reports scrollbackBytes > 0 for
 * the current task. Fresh tasks with no persisted scrollback get no footer.
 */

import { useLocalStorage } from "../../hooks/useLocalStorage";

export function PrivacyDisclosureFooter({
  scrollbackBytes,
  retentionDays,
  scrollbackDir,
}: {
  scrollbackBytes: number | null;
  retentionDays: number | null;
  scrollbackDir: string | null;
}) {
  const STORAGE_KEY = "webui:terminal-privacy-disclosure-dismissed";
  const [dismissed, setDismissed] = useLocalStorage<boolean>(STORAGE_KEY, false);
  // AC-8: hide entirely until the server has POSITIVELY reported a non-zero
  // scrollback byte count. `null` means we have not received the ready /
  // scrollback-meta envelope yet (or the WS is not open at all); we hide in
  // that case so a fresh task with no scrollback does not flicker the footer
  // in the gap between mount and ready.
  if (scrollbackBytes === null || scrollbackBytes <= 0) return null;
  if (dismissed) return null;
  const isWindows = typeof navigator !== "undefined" &&
    /windows/i.test(navigator.userAgent);
  // AC-9: interpolate retention copy. Fall back to "1 day" + a generic env-var
  // hint if the server hasn't reported the value yet — guards against a flicker
  // before the ready envelope arrives. The plural is `day(s)` because i18n is
  // out of scope for this iterate.
  const days = typeof retentionDays === "number" && retentionDays > 0
    ? retentionDays
    : 1;
  const dir = scrollbackDir && scrollbackDir.length > 0
    ? scrollbackDir
    : null;
  return (
    // Iterate v0.8.3 AC-2 — match the EmbeddedTerminal's outer p-2/rounded-md
    // wrapper. With 8px padding around the xterm canvas, the previous
    // `bottom-0 left-0 right-0` flush-edge footer would have read as belonging
    // to the parent surface, not the terminal box. Inset to bottom-2/left-2/
    // right-2 + rounded-md so the footer visually belongs to the padded box.
    <div
      className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-md border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] px-3 py-1.5 text-[11px] text-[var(--color-muted,#6b7280)]"
      data-testid="terminal-privacy-disclosure"
    >
      <span aria-hidden>ⓘ</span>
      <span className="flex-1 truncate">
        Terminal scrollback persists for {days} day(s){dir ? (
          <> at <code className="rounded bg-[var(--color-muted-bg,#ede8e1)] px-1">{dir}</code></>
        ) : null}. May contain command output including secrets / env vars.{" "}
        {isWindows ? (
          <span>On Windows, file permissions rely on user-account ACLs.</span>
        ) : null}
        {" "}Use the <code className="rounded bg-[var(--color-muted-bg,#ede8e1)] px-1">⋮ → Clear terminal history</code> menu to remove.{" "}
        Image pastes inside Claude Code's TUI land in <code className="rounded bg-[var(--color-muted-bg,#ede8e1)] px-1">~/.claude/image-cache/&lt;sessionId&gt;/</code> (managed by Claude Code, not WebUI).
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[var(--color-muted,#6b7280)] hover:text-[var(--color-text,#1a1a1a)]"
        data-testid="terminal-privacy-disclosure-dismiss"
        aria-label="Dismiss privacy notice"
      >
        ×
      </button>
    </div>
  );
}
