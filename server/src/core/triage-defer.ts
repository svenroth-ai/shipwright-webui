/*
 * triage-defer.ts — TS port of the parked-entry lifecycle from
 * `shared/scripts/lib/triage_defer.py` (monorepo P2.03,
 * iterate-2026-08-01-triage-defer-lifecycle, CONTRACT_VERSION 2).
 *
 * A parked (`status: "snoozed"`) entry names the day it should return
 * (`revisitAt`, strictly `YYYY-MM-DD`). The park expires by DERIVATION, not
 * by a writer: `applyDeferOverlay` resolves a due park back to
 * `status: "triage"` on every read — nothing appends a second event. Applied
 * EXACTLY ONCE per resolved view (in `triage-store.ts` / `triage-compose.ts`,
 * at cache-fill time), mirroring upstream `read_all_items`, which calls
 * `_defer.apply_revisit_expiry` once at the end and never re-applies it to an
 * already-overlaid view (re-applying would null out a due item's `revisitAt`
 * and re-flip `revisitDue` to false — see iterate-2026-08-05-triage-deferred-
 * envelope plan review M2).
 *
 * An entry with no `revisitAt` (today's WebUI Snooze, and the
 * upstream-permitted no-date park) is `revisitDue: false` forever —
 * "parked-not-due" — by construction: `isDue` treats an unreadable or
 * missing date as not due, the conservative direction.
 */

import type { TriageItem } from "../types/triage.js";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Sorts after every known severity — a hand-edited severity never jumps the queue. */
const UNKNOWN_SEVERITY_RANK = 1_000;

/**
 * Exactly `YYYY-MM-DD`, and a real calendar date (rejects e.g. 2026-02-30),
 * or `null`. Strict on purpose — mirrors Python `parse_revisit_date`'s
 * `datetime.strptime(raw, "%Y-%m-%d")`, which rejects a non-zero-padded or
 * out-of-range component. An unreadable value is never guessed at; it is
 * treated as "no date" everywhere downstream.
 */
export function parseRevisitDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = DATE_PATTERN.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

/** The UTC calendar day of `now`, as `YYYY-MM-DD`. */
export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Has a park named for `raw` come due as of `todayIso`? A park named for day
 * D is due FROM 00:00:00 UTC on D (`todayIso >= D`) — open ON the named day,
 * not the day after. An unreadable or missing value is NOT due — the
 * conservative direction: a damaged date must not silently re-open an entry.
 */
export function isDue(raw: unknown, todayIso: string): boolean {
  const parsed = parseRevisitDate(raw);
  return parsed !== null && todayIso >= parsed;
}

/**
 * Overlay park expiry on an already-resolved view. Every item gains
 * `revisitDue`; a `snoozed` item whose date has come reads `status: "triage"`
 * (its `revisitAt` is left untouched, so the two open-looking cases —
 * never-parked vs. just-returned — stay distinguishable). Returns NEW item
 * objects (never mutates the input) but is a pure function of its input, so
 * a caller applying it exactly once per resolved view (never to its own
 * output) gets a stable result — see the module header.
 */
export function applyDeferOverlay(items: TriageItem[], now: Date): TriageItem[] {
  const today = utcToday(now);
  return items.map((item) => {
    const parked = item.status === "snoozed";
    const due = parked && isDue(item.revisitAt, today);
    return {
      ...item,
      revisitDue: due,
      status: due ? "triage" : item.status,
    };
  });
}

/**
 * Order parked entries for display — a TOTAL order (the trailing id key
 * breaks every tie, so "the first N" never depends on incoming order).
 * Soonest dated return first, then undated entries, then severity (critical
 * first, unknown last), then id. Returns a new array; the input is untouched.
 */
export function sortDeferred(
  items: TriageItem[],
  severityRank: Record<string, number>,
): TriageItem[] {
  const keyed = items.map((item) => {
    const parsed = parseRevisitDate(item.revisitAt);
    const rank =
      typeof item.severity === "string"
        ? (severityRank[item.severity] ?? UNKNOWN_SEVERITY_RANK)
        : UNKNOWN_SEVERITY_RANK;
    return {
      item,
      hasNoDate: parsed === null,
      dateKey: parsed ?? "",
      rank,
      idKey: item.id ?? "",
    };
  });
  keyed.sort((a, b) => {
    if (a.hasNoDate !== b.hasNoDate) return a.hasNoDate ? 1 : -1;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.idKey !== b.idKey) return a.idKey < b.idKey ? -1 : 1;
    return 0;
  });
  return keyed.map((k) => k.item);
}
