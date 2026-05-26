/*
 * AnswerInTerminalButton — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * R6 (iterate 3.7e-a) — compact brown-solid button rendered inside the
 * ask-bubble. Label: "Answer". Icon: Lucide Terminal, LEFT of label.
 * Click copies the resume command to the clipboard. Does NOT navigate —
 * the user pastes into their already-open terminal.
 *
 * Extracted from `BubbleTranscript/ToolOutputBlock.tsx` to keep that file
 * under the 300-LOC cleanup-invariant cap.
 */

import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { Terminal as TerminalIcon } from "lucide-react";

import { useLaunchTask } from "../../../hooks/useLaunchTask";
import type { CopyCommandForms, ExternalTask } from "../../../lib/externalApi";

export function AnswerInTerminalButton({ task }: { task: ExternalTask }) {
  const launchMut = useLaunchTask();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform: "windows" | "posix" = useMemo(() => {
    if (typeof navigator === "undefined") return "posix";
    return /windows/i.test(navigator.userAgent) ? "windows" : "posix";
  }, []);

  const handleClick = useCallback(
    async (ev: MouseEvent<HTMLButtonElement>) => {
      ev.stopPropagation();
      setError(null);
      try {
        const result = await launchMut.mutateAsync({
          taskId: task.taskId,
          resume: true,
        });
        const command = pickBubbleCommand(result.commands, platform);
        await writeBubbleClipboard(command);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [launchMut, task.taskId, platform],
  );

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={(ev) => void handleClick(ev)}
        disabled={launchMut.isPending}
        className={
          "inline-flex items-center justify-center gap-1.5 " +
          "font-semibold text-white transition-colors " +
          "disabled:cursor-not-allowed disabled:opacity-60 " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        }
        style={{
          borderRadius: "var(--radius-button, 8px)",
          background: "var(--color-primary, #6b5e56)",
          padding: "5px 12px",
          fontSize: "12px",
          fontWeight: 600,
        }}
        onMouseEnter={(ev) => {
          ev.currentTarget.style.background =
            "var(--color-primary-hover, #5a4f48)";
        }}
        onMouseLeave={(ev) => {
          ev.currentTarget.style.background = "var(--color-primary, #6b5e56)";
        }}
        title={copied ? "Copied!" : "Copy resume command"}
        aria-label="Answer — copy resume command to clipboard"
        data-testid="askuser-answer-in-terminal"
      >
        <TerminalIcon size={13} />
        <span className="leading-none">
          {copied ? "Copied" : "Answer"}
        </span>
      </button>
      {error && (
        <span
          role="alert"
          className="text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function pickBubbleCommand(
  commands: CopyCommandForms,
  platform: "windows" | "posix",
): string {
  return platform === "windows" ? commands.powershell : commands.posix;
}

async function writeBubbleClipboard(text: string): Promise<void> {
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
