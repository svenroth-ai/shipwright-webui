/*
 * external/org/cron.ts — pure cron/staleness math for FR-04.06's "3x
 * cadence" threshold (iterate-2026-08-18-org-route-beat-register, contract
 * name (c): `Lead.triggers.cron`, decided by leadwright, consumed here).
 *
 * No filesystem access — see `org-chart-lookup.ts` for the reader that
 * supplies `cron`. Kept separate so the arithmetic is trivially unit-
 * testable without any fixture directory.
 *
 * Plan-review fix (PR-7, openai): `cron-parser` resolves relative to the
 * SYSTEM timezone by default, which is nondeterministic across deployments
 * — every timestamp elsewhere in this route family is UTC (ISO-8601 'Z'),
 * so this module pins `tz: "UTC"` explicitly rather than inheriting the
 * host's local zone.
 *
 * Disclosed limitation (plan-review PR-7 / iterate spec "Confidence
 * Calibration"): the cadence is derived from the gap between the NEXT TWO
 * occurrences after `from`, not from the cron expression's fixed period.
 * For a regular schedule (e.g. every 15 minutes) these are identical. For an
 * irregular one (monthly, day-of-week combinations, a DST transition
 * inside the window) the gap can vary depending on where `from` falls in
 * the schedule — this is an accepted approximation of "configured cadence"
 * for staleness alerting, not an exact-occurrence scheduler. The task
 * brief asks to derive the threshold from `triggers.cron` rather than
 * hard-code it; it does not ask for recurrence-aware staleness.
 */

import { CronExpressionParser } from "cron-parser";

export type CronIntervalResult = { ok: true; ms: number } | { ok: false };

/** The gap (ms) between the next two occurrences of `cron` after `from`. */
export function cronIntervalMs(cron: string, from: Date): CronIntervalResult {
  try {
    const interval = CronExpressionParser.parse(cron, { currentDate: from, tz: "UTC" });
    const first = interval.next().getTime();
    const second = interval.next().getTime();
    const ms = second - first;
    if (!Number.isFinite(ms) || ms <= 0) {
      return { ok: false };
    }
    return { ok: true, ms };
  } catch {
    return { ok: false };
  }
}

export type Staleness = "fresh" | "stale";

export interface StalenessEvaluation {
  staleness: Staleness;
  thresholdMs: number;
  ageMs: number;
}

/**
 * `stale` iff the age of `lastRunAt` (relative to `now`) is STRICTLY
 * greater than `3 * cadenceMs` — an age exactly at the threshold is fresh.
 * Boundary is deliberate and tested (task brief: "the boundary case is
 * tested").
 */
export function evaluateStaleness(
  lastRunAt: string,
  cadenceMs: number,
  now: Date,
): StalenessEvaluation {
  const thresholdMs = 3 * cadenceMs;
  const ageMs = now.getTime() - new Date(lastRunAt).getTime();
  return {
    staleness: ageMs > thresholdMs ? "stale" : "fresh",
    thresholdMs,
    ageMs,
  };
}
