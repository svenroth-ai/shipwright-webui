/*
 * sortDeferred.ts — client-side mirror of the server's
 * `core/triage-defer.ts::sortDeferred` (itself a TS port of the monorepo's
 * `lib/triage_defer.py::sort_deferred`, P2.03 / CONTRACT_VERSION 2).
 *
 * The live `GET /api/triage/:projectId` response stays `{items, origin}`
 * (all statuses, unfiltered) — see the iterate spec's Technical Approach —
 * so the Deferred section's ordering is computed here, client-side, from
 * that same response rather than from a second server call.
 */

import type { TriageItem, TriageSeverity } from "./triageApi";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNKNOWN_SEVERITY_RANK = 1_000;

/** Exactly `YYYY-MM-DD` and a real calendar date, else `null`. */
function parseRevisitDate(raw: string | null): string | null {
  if (raw === null) return null;
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

/**
 * Order parked entries for display — a TOTAL order (the trailing id key
 * breaks every tie). Soonest dated return first, then undated entries, then
 * severity (critical first, unknown last), then id. Returns a new array.
 */
export function sortDeferred(
  items: TriageItem[],
  severityRank: Record<TriageSeverity, number>,
): TriageItem[] {
  const keyed = items.map((item) => {
    const parsed = parseRevisitDate(item.revisitAt);
    const rank = severityRank[item.severity] ?? UNKNOWN_SEVERITY_RANK;
    return {
      item,
      hasNoDate: parsed === null,
      dateKey: parsed ?? "",
      rank,
      idKey: item.id,
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
