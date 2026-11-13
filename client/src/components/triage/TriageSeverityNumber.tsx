/*
 * TriageSeverityNumber — severity as a small ROUND numbered badge for the dark
 * Triage lanes (iterate-2026-11-13-triage-rows-round3): 1 critical, 2 high,
 * 3 medium, 4 low, 5 info. It sits in the right-hand meta cluster of a row,
 * just before the copyable id, so the title keeps a clean left edge. The word
 * stays available as the tooltip and the accessible name. Dark-surface only
 * (white tints); the light surfaces (detail dialog, promote dialog) keep the
 * word badge `SeverityBadge`.
 */

import type { TriageSeverity } from "../../lib/triageApi";

export const SEVERITY_RANK: Record<TriageSeverity, 1 | 2 | 3 | 4 | 5> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  info: 5,
};

const RANK_CLASSES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "border-transparent bg-[var(--err-solid)] text-white",
  2: "border-transparent bg-[var(--warn-solid)] text-[var(--ink-fixed)]",
  3: "border-[var(--warn-solid)] bg-[var(--warn-solid)]/15 text-[var(--warn-solid)]",
  4: "border-white/30 bg-white/10 text-white/90",
  5: "border-white/20 bg-transparent text-white/60",
};

const WORD: Record<TriageSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export function SeverityNumber({
  severity,
  small = false,
}: {
  severity: TriageSeverity;
  small?: boolean;
}) {
  const rank = SEVERITY_RANK[severity];
  return (
    <span
      role="img"
      aria-label={`Severity: ${WORD[severity]}`}
      title={`Severity ${rank} · ${WORD[severity]}`}
      data-testid={small ? undefined : `triage-severity-${severity}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-bold tabular-nums ${
        small ? "h-[18px] w-[18px] text-[11px]" : "h-6 w-6 text-xs"
      } ${RANK_CLASSES[rank]}`}
    >
      {rank}
    </span>
  );
}

/** Plain-text key to the numbers (no pill chrome, so it never reads as a filter). */
export function SeverityLegend() {
  const keys: TriageSeverity[] = ["critical", "high", "medium", "low", "info"];
  return (
    <p
      className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg bg-black/35 px-2.5 py-1 text-xs text-white/90"
      data-testid="triage-severity-legend"
    >
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <SeverityNumber severity={k} small />
          {WORD[k]}
        </span>
      ))}
    </p>
  );
}
