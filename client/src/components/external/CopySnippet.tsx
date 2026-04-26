/*
 * Small monospace command snippet with a copy button. Used for the
 * `recover-phase-task` snippets emitted by MasterTaskCard's failure /
 * needs_validation / stale states.
 *
 * Plain clipboard write — no framework dependency. The Continue Pipeline
 * launch flow uses its own clipboard helper inside useContinuePipeline
 * so the platform-pick lives there; this is just for static snippets.
 */

import { useCallback, useState } from "react";
import { Copy } from "lucide-react";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  /** The exact command to copy. Rendered verbatim, monospaced. */
  command: string;
  /** Aria label / button title. Defaults to "Copy command". */
  label?: string;
}

export function CopySnippet({ command, label, ...rest }: Props) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = command;
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
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow — UI keeps the snippet visible so user can copy by hand */
    }
  }, [command]);
  return (
    <div
      {...rest}
      className={
        "flex items-start gap-2 rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-white p-2"
      }
    >
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-[var(--color-text,#1a1a1a)]">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={label ?? "Copy command"}
        title={copied ? "Copied!" : (label ?? "Copy command")}
        className="flex h-6 shrink-0 items-center gap-1 rounded-[6px] bg-[var(--color-muted-bg,#ede8e1)] px-2 text-[11px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
      >
        <Copy size={11} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
