/*
 * PrLinkCard — iterate-2026-05-27-transcript-renderer-scroll AC2,
 * extended by iterate-2026-05-30-pr-card-status.
 *
 * Renders Claude Code `type: "pr-link"` events as a message-bubble-shaped
 * card matching the assistant bubble geometry (max-w-[90%], px-3 py-2,
 * text-sm, 14px radius with a 4px top-left tail) plus an open/merged status
 * pill sourced from `usePrStatus` (GET /api/external/pr-status, gh-backed).
 *
 * Security: `prUrl` is parser-validated at the io-boundary (`^https?://`
 * scheme guard, finite `prNumber`, non-empty `prRepository`); the anchor
 * adds `rel="noopener noreferrer"` + `target="_blank"` belt-and-suspenders.
 * Status `unknown` (gh unavailable / offline / parse failure) renders no
 * pill — the card degrades gracefully.
 */

import { Github, ExternalLink } from "lucide-react";

import type { PrLinkEvent } from "../../../external/session-parser";
import { usePrStatus } from "../../../hooks/usePrStatus";
import type { PrState } from "../../../lib/prStatusApi";

interface Props {
  event: PrLinkEvent;
}

const STATE_STYLE: Record<
  Exclude<PrState, "unknown">,
  { label: string; bg: string; fg: string }
> = {
  open: {
    label: "Open",
    bg: "var(--color-success-bg, #e6f4ea)",
    fg: "var(--color-success-text, #1a7f37)",
  },
  merged: { label: "Merged", bg: "rgba(137, 87, 229, 0.14)", fg: "#8957e5" },
  closed: {
    label: "Closed",
    bg: "var(--color-error-bg, #fce8e6)",
    fg: "var(--color-error, #d1242f)",
  },
  draft: {
    label: "Draft",
    bg: "var(--color-muted-bg, #f0ede8)",
    fg: "var(--color-muted, #6b7280)",
  },
};

function PrStateBadge({ state }: { state: Exclude<PrState, "unknown"> }) {
  const s = STATE_STYLE[state];
  return (
    <span
      className="inline-flex items-center rounded-[999px] font-semibold"
      style={{ padding: "1px 8px", fontSize: "11px", background: s.bg, color: s.fg }}
      data-testid={`pr-state-${state}`}
    >
      {s.label}
    </span>
  );
}

export function PrLinkCard({ event }: Props) {
  const { data: status } = usePrStatus(event.prUrl);
  const badgeState =
    status && status.state !== "unknown" ? status.state : null;

  return (
    <div className="flex justify-start" data-testid="pr-link-card">
      <a
        href={event.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex max-w-[90%] items-center gap-2 px-3 py-2 text-sm no-underline"
        style={{
          background: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e0dbd4)",
          borderRadius: "14px",
          borderTopLeftRadius: "4px",
          color: "var(--color-text, #1a1a1a)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
        data-testid="pr-link-anchor"
      >
        <Github
          size={15}
          aria-hidden="true"
          style={{ color: "var(--color-muted, #6b7280)" }}
        />
        <span style={{ color: "var(--color-muted, #6b7280)" }}>
          {event.prRepository}
        </span>
        <strong style={{ fontWeight: 600, color: "var(--color-accent, #857568)" }}>
          #{event.prNumber}
        </strong>
        {badgeState && <PrStateBadge state={badgeState} />}
        <ExternalLink
          size={12}
          aria-hidden="true"
          style={{ color: "var(--color-muted, #6b7280)", opacity: 0.7 }}
        />
      </a>
    </div>
  );
}
