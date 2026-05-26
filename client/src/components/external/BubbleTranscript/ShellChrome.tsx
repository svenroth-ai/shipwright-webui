/*
 * BubbleTranscript shell chrome — Campaign-C C3 split (2026-05-26).
 *
 * Small layout primitives consumed only by the `BubbleTranscript` shell:
 *   - `EmptyTranscript`: centered empty state with Lucide icon + heading.
 *   - `JumpToLatestButton`: floating CTA shown when the user scrolled away.
 *   - `MalformedBanner`: warning strip when the parser dropped lines.
 *
 * Extracted from `BubbleTranscript.tsx` to keep the shell under the
 * sub-iterate spec's 200-LOC cap.
 */

import { MessageSquare } from "lucide-react";

export function EmptyTranscript() {
  return (
    <div
      className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="transcript-empty"
    >
      <MessageSquare size={48} aria-hidden="true" style={{ color: "var(--color-muted, #6b7280)" }} />
      <div
        className="text-[16px] font-semibold"
        style={{ color: "var(--color-text, #1a1a1a)" }}
        data-testid="transcript-empty-heading"
      >
        No events yet
      </div>
      <div className="max-w-[320px] text-[13px]" style={{ color: "var(--color-muted, #6b7280)" }}>
        Launch the task to start streaming the assistant transcript here.
      </div>
    </div>
  );
}

export function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 right-3 rounded-full px-3 py-1 text-xs font-medium shadow-md transition-colors"
      style={{
        background: "var(--color-primary, #6b5e56)",
        color: "#fff",
        boxShadow: "var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.06))",
      }}
      data-testid="jump-to-latest"
    >
      ↓ Jump to latest
    </button>
  );
}

export function MalformedBanner({ count }: { count: number }) {
  return (
    <div
      className="mx-3 mb-2 rounded p-1 text-xs"
      style={{
        border: "1px solid var(--color-warning, #D97706)",
        background: "var(--color-warning-bg, #FEF3C7)",
        color: "var(--color-warning-text, #92400E)",
      }}
    >
      {count} malformed line(s) (likely a torn read on the trailing partial line being written).
    </div>
  );
}
