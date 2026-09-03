/*
 * leadUsageDisplay.ts — pure display logic for `LeadCard`'s "consumed"
 * stat (iterate spec FR-04.30 display half). Split out of `LeadCard.tsx`
 * to keep that file under the 300-line convention.
 */
import type { UsageResponse } from "../../lib/orgApi";

/**
 * The label names CONSUMED spend with its currency — it must never carry
 * a remaining-allowance word ("budget"), because this figure is a spend
 * total, not an allowance the lead has left.
 */
export function usageLabel(usage: UsageResponse): string {
  return usage.measured ? `${usage.windowDays}-day USD consumed` : "USD consumed";
}

/**
 * `measured: true` + `anyNotMeasured` is a PARTIAL total (some sessions in
 * the window measured, some didn't) — it must read differently from a
 * complete one, never as a confident number. `costUsd: 0` is a real
 * measured value and must render as "$0.00", never as "not measured" —
 * the branch is on `.measured`, never on the number's truthiness.
 */
export function usageValueText(usage: UsageResponse): string {
  if (!usage.measured) return "not measured";
  const amount = `$${usage.costUsd.toFixed(2)}`;
  return usage.anyNotMeasured ? `${amount} (partial)` : amount;
}

/**
 * A lead's SUBAGENT spend runs under the same session but in a transcript
 * the counter never reads — the display must NAME that gap, never
 * quantify it. `unpricedCallsTotal` is the one number that IS countable,
 * so it's surfaced here — but only when > 0 (a `0` is a real "nothing
 * uncounted" result, not worth a line).
 */
export function usageNoteText(usage: UsageResponse): string | null {
  if (!usage.measured) return null;
  const parts = [usage.anyNotMeasured ? "Partial window — excludes subagent spend" : "Excludes subagent spend"];
  if (usage.unpricedCallsTotal !== undefined && usage.unpricedCallsTotal > 0) {
    parts.push(`${usage.unpricedCallsTotal} unpriced call${usage.unpricedCallsTotal === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
