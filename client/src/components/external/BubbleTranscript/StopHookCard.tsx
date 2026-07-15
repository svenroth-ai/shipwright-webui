/*
 * StopHookCard — iterate-2026-05-27-transcript-renderer-scroll AC3.
 *
 * Collapsed-by-default Tool-call-style card for Claude Code Stop-hook
 * output. Replaces the right-aligned user bubble that previously showed
 * the full ASCII-art banner verbatim (it appeared ~12× per session and
 * was indistinguishable from a real user message).
 *
 * Modeled on `SkillCard.tsx`: chip header (ShieldAlert icon + STOP HOOK
 * label + gate name + chevron) expands to reveal the raw body in a
 * `<pre>` (the body is ASCII art + monospace text — NOT Markdown, so it
 * must NOT flow through the Markdown pipeline or the banner box-drawing
 * would be mangled).
 *
 * Expansion state is local to the component instance (`useState`).
 * `stableEventKey` (filters.ts) keys transcript rows by `event.uuid`,
 * which Claude always emits, so polling-driven re-renders preserve the
 * expanded state.
 *
 * Security: `body` is user-originated transcript content rendered as a
 * React text node inside `<pre>` — no HTML/Markdown pass-through, so no
 * injection surface. This matches how every other raw transcript body
 * is displayed; no additional redaction applies (external-review LOW-12).
 */

import { useState } from "react";
import { ShieldAlert, ChevronRight } from "lucide-react";

interface Props {
  gateName: string;
  body: string;
}

export function StopHookCard({ gateName, body }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex justify-start" data-testid="stop-hook-card">
      <div
        className="max-w-[90%] w-full overflow-hidden"
        style={{
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-warning, #D97706)",
          borderRadius: "var(--radius-button, 8px)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        }}
        data-expanded={expanded ? "true" : "false"}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left"
          style={{ minHeight: 38, background: "transparent", cursor: "pointer" }}
          data-testid="stop-hook-card-header"
          aria-expanded={expanded}
        >
          <div
            className="flex items-center justify-center rounded-md shrink-0"
            style={{
              width: 22,
              height: 22,
              background: "var(--color-warning-bg, #FEF3C7)",
              color: "var(--color-warning, #D97706)",
            }}
          >
            <ShieldAlert size={12} aria-hidden="true" />
          </div>
          <span
            className="shrink-0 text-[11px] uppercase tracking-wide"
            style={{ color: "var(--color-warning-text, #92400E)", fontWeight: 600 }}
          >
            Stop hook
          </span>
          <span
            className="flex-1 min-w-0 font-mono text-[12.5px] truncate"
            style={{ color: "var(--color-text, #1a1a1a)", fontWeight: 500 }}
            data-testid="stop-hook-card-gate"
          >
            {gateName}
          </span>
          <ChevronRight
            size={14}
            className="shrink-0"
            style={{
              color: "var(--color-muted, #6b7280)",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div
            className="px-3.5 py-2.5"
            style={{
              borderTop: "1px solid var(--color-border, #e0dbd4)",
              background: "var(--card)",
            }}
            data-testid="stop-hook-card-body"
          >
            <pre
              className="overflow-x-auto text-[11.5px] leading-snug"
              style={{
                fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
                color: "var(--color-text, #1a1a1a)",
                whiteSpace: "pre",
                margin: 0,
              }}
            >
              {body}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
