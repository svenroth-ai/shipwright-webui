/*
 * StateBadge — extracted from TaskDetailHeader (Campaign C / C6, 2026-05-26).
 *
 * Renders the rounded-pill status badge with the pulsing dot. The badge
 * palette (`STATE_BADGE`) and the inline `@keyframes` rule for the pulse
 * are co-located here so the parent shell never re-imports either. The
 * outer <span> is the EXACT outermost DOM node from the pre-split
 * component — no wrapping fragment/div was added, to preserve the
 * title-row flex layout bit-perfect (GEM-1 in C6 plan review).
 */
import type { ExternalTaskState } from "../../../lib/externalApi";

const STATE_BADGE: Record<
  ExternalTaskState,
  { bg: string; fg: string; dot: string; label: string; pulse: boolean }
> = {
  draft: {
    bg: "bg-[var(--color-muted-bg,#ede8e1)]",
    fg: "text-[var(--color-muted,#6b7280)]",
    dot: "bg-[var(--color-muted,#6b7280)]",
    label: "Draft",
    pulse: false,
  },
  awaiting_external_start: {
    bg: "bg-warn-tint",
    fg: "text-warn",
    dot: "bg-[var(--warn-solid)]",
    label: "Awaiting launch",
    pulse: true,
  },
  active: {
    bg: "bg-warn-tint",
    fg: "text-warn",
    dot: "bg-[var(--warn-solid)]",
    label: "In progress",
    pulse: true,
  },
  idle: {
    bg: "bg-[var(--color-muted-bg,#ede8e1)]",
    fg: "text-[var(--color-muted,#6b7280)]",
    dot: "bg-[var(--color-muted,#6b7280)]",
    label: "Idle",
    pulse: false,
  },
  jsonl_missing: {
    bg: "bg-err-tint",
    fg: "text-err",
    dot: "bg-[var(--color-error,#DC2626)]",
    label: "JSONL missing",
    pulse: false,
  },
  launch_failed: {
    bg: "bg-err-tint",
    fg: "text-err",
    dot: "bg-[var(--color-error,#DC2626)]",
    label: "Launch failed",
    pulse: false,
  },
  done: {
    bg: "bg-ok-tint",
    fg: "text-ok",
    dot: "bg-[var(--color-success,#059669)]",
    label: "Done",
    pulse: false,
  },
};

export interface StateBadgeProps {
  /** Task state; selects the badge label, palette, and pulse animation. */
  state: ExternalTaskState;
}

/**
 * Re-export so the shell composition root can inject the `@keyframes`
 * rule at the same DOM position as the pre-split component (sibling of
 * `<Link>` inside `<header>`). Keeping the `<style>` inside this badge
 * would change the outermost DOM node from `<span>` to a fragment +
 * sibling `<style>`, which violates the bit-perfect-behavior AC
 * (Gemini-1 / OpenAI HIGH-1 from C6 code review).
 */
export const STATE_BADGE_KEYFRAMES =
  `@keyframes taskDetailPulseDot { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`;

export function StateBadge({ state }: StateBadgeProps) {
  const badge = STATE_BADGE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.fg}`}
      data-testid="task-state-badge"
    >
      <span
        className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${badge.dot}`}
        data-testid="task-detail-state-dot"
        data-state={state}
        style={
          badge.pulse
            ? { animation: "taskDetailPulseDot 1.5s infinite" }
            : undefined
        }
      />
      {badge.label}
    </span>
  );
}
