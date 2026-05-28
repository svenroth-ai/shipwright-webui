/*
 * PrLinkCard — iterate-2026-05-27-transcript-renderer-scroll AC2.
 *
 * Left-aligned anchor card for Claude Code `type: "pr-link"` events.
 * Replaces the legacy yellow "Unknown event: pr-link" disclosure that
 * appeared ~13× per session in any iterate that opened a PR.
 *
 * Security: `prUrl` is parser-validated at the io-boundary
 * (`^https?://` scheme guard, finite `prNumber`, non-empty
 * `prRepository`). The card itself adds `rel="noopener noreferrer"`
 * and `target="_blank"` belt-and-suspenders. External-review HIGH-1.
 *
 * Visual: GitHub icon · `<repo> #<number>` · ExternalLink chevron.
 * CSS-var palette (theme-aware). No body, no collapsible state.
 */

import { Github, ExternalLink } from "lucide-react";

import type { PrLinkEvent } from "../../../external/session-parser";

interface Props {
  event: PrLinkEvent;
}

export function PrLinkCard({ event }: Props) {
  return (
    <div className="flex justify-start" data-testid="pr-link-card">
      <a
        href={event.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-3 py-1.5 text-[12.5px] no-underline"
        style={{
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e0dbd4)",
          borderRadius: "var(--radius-button, 8px)",
          color: "var(--color-text, #1a1a1a)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
        data-testid="pr-link-anchor"
      >
        <Github size={14} aria-hidden="true" style={{ color: "var(--color-muted, #6b7280)" }} />
        <span style={{ color: "var(--color-muted, #6b7280)" }}>{event.prRepository}</span>
        <strong style={{ fontWeight: 600, color: "var(--color-accent, #857568)" }}>
          #{event.prNumber}
        </strong>
        <ExternalLink
          size={11}
          aria-hidden="true"
          style={{ color: "var(--color-muted, #6b7280)", opacity: 0.7 }}
        />
      </a>
    </div>
  );
}
