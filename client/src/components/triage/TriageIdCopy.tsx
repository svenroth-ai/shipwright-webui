/*
 * TriageIdCopy — a triage id you can select with the mouse (double-click)
 * plus a small copy button next to it (iterate-2026-11-12-triage-lanes-rows).
 * The id is what the operator pastes to an agent ("fix trg-1a2b"), so it must
 * be copyable straight from the list. Clicks on the id never open the detail
 * dialog (`data-no-open`), otherwise a double-click would open it before the
 * word is selected. Clipboard failures fall back to selecting the text so
 * Ctrl+C still works.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

function selectNode(node: HTMLElement | null): void {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function TriageIdCopy({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      selectNode(codeRef.current);
    }
  };

  return (
    <span className="inline-flex items-center gap-1" data-no-open>
      <code
        ref={codeRef}
        className="cursor-text select-all rounded bg-white/10 px-1.5 py-px font-mono text-xs text-white/85"
        data-testid={`triage-item-${id}-id`}
      >
        {id}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? `Copied ${id}` : `Copy ${id}`}
        title={copied ? "Copied" : "Copy ID"}
        data-testid={`triage-item-${id}-copy`}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span className="sr-only" aria-live="polite">
          {copied ? "Copied" : ""}
        </span>
      </button>
    </span>
  );
}
