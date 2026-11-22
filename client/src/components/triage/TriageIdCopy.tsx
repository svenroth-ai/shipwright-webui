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

export interface TriageIdCopyProps {
  id: string;
  /** Shown instead of `id` (the Inbox shows 8 characters of a session UUID and copies all of it). */
  display?: string;
  /** What the copy button puts on the clipboard (default: `id`). */
  copyValue?: string;
  /** Test-id base: `<base>-id` / `<base>-copy` (default `triage-item-<id>`). */
  testIdBase?: string;
  title?: string;
  /** Accessible name of the copy button (default: `Copy <id>`). */
  label?: string;
}

export function TriageIdCopy({ id, display, copyValue, testIdBase, title, label }: TriageIdCopyProps) {
  const base = testIdBase ?? `triage-item-${id}`;
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
      await navigator.clipboard.writeText(copyValue ?? id);
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
        title={title}
        data-testid={`${base}-id`}
      >
        {display ?? id}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? (label ? "Copied" : `Copied ${id}`) : (label ?? `Copy ${id}`)}
        title={copied ? "Copied" : "Copy ID"}
        data-testid={`${base}-copy`}
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
