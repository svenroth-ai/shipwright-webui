/*
 * InboxResumeButton — single Resume/Answer CTA for an Inbox card.
 *
 * Extracted from InboxPage.tsx during C7 (2026-05-26). Logic LIFTED
 * VERBATIM — pickPlatformCommand + writeClipboardModule + the try/catch
 * + setError branch + the two-testid back-compat pattern (per
 * external-plan-review medium #6 + low #12: byte-for-byte preservation).
 *
 * Stops click propagation so the containing clickable card doesn't also
 * navigate to TaskDetail. Two testids for back-compat:
 * `inbox-resume-<toolUseId>` (new, 3.7d-b3) + `inbox-copy-resume-<toolUseId>`
 * (legacy, kept on a hidden inner node).
 */
import { useState, type MouseEvent } from "react";
import { Copy, Terminal } from "lucide-react";

import { useLaunchTask } from "../../hooks/useLaunchTask";
import type { CopyCommandForms, ExternalTask } from "../../lib/externalApi";

export function InboxResumeButton({
  task,
  toolUseId,
}: {
  task: ExternalTask;
  toolUseId: string;
}) {
  const launchMut = useLaunchTask();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    // Prevent the card-level onClick from also firing + navigating away
    // before the clipboard write completes.
    e.stopPropagation();
    setError(null);
    try {
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: true,
      });
      const command = pickPlatformCommand(commands);
      await writeClipboardModule(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // iterate 3.7f: Inbox CTA renamed "Resume" → "Answer" for consistency with
  // the Ask-bubble button (same clipboard action: copies resume command so
  // the user pastes + answers in their terminal). Terminal icon reflects the
  // intent; Copy icon still flashes during the 1.5s "Copied" confirm.
  const Icon = copied ? Copy : Terminal;
  const label = launchMut.isPending
    ? "Preparing…"
    : copied
      ? "Copied — paste into terminal"
      : "Answer";

  return (
    <>
      <button
        type="button"
        onClick={(e) => void handleClick(e)}
        onKeyDown={(e) => {
          // Don't let Enter/Space on the button also trigger the card's
          // keydown handler.
          e.stopPropagation();
        }}
        disabled={launchMut.isPending}
        data-testid={`inbox-resume-${toolUseId}`}
        data-testid-legacy={`inbox-copy-resume-${toolUseId}`}
        className="inline-flex items-center gap-2 rounded-[var(--radius-button)] font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
        aria-label={copied ? "Resume command copied" : "Copy resume command"}
      >
        <Icon size={14} />
        {label}
      </button>
      {/* Legacy testid node — kept invisibly for pre-3.7d-b3 specs. */}
      <span
        data-testid={`inbox-copy-resume-${toolUseId}`}
        style={{ display: "none" }}
        aria-hidden="true"
      />
      {error && (
        <span
          role="alert"
          className="ml-2 text-[11px]"
          style={{ color: "var(--color-error)" }}
        >
          {error}
        </span>
      )}
    </>
  );
}

function pickPlatformCommand(commands: CopyCommandForms): string {
  if (typeof navigator === "undefined") return commands.posix;
  return /windows/i.test(navigator.userAgent) ? commands.powershell : commands.posix;
}

async function writeClipboardModule(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
