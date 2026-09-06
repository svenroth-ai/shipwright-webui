/*
 * auditTimelineMerge.ts — pure, framework-free merge core for the
 * cross-lead audit timeline (iterate-2026-09-06-org-audit-timeline).
 *
 * See the iterate spec's "The pagination trap" section for the full
 * decision history. Short version: `before` on
 * `GET /api/org/leads/:leadId/audit` is a PHYSICAL POSITION count into that
 * lead's own newest-first stream, not a timestamp — so persisting a
 * per-lead "consumed count" cursor across rounds breaks the moment the
 * underlying file grows between rounds (the daemon appends overnight,
 * possibly while this is open). Two rounds of external review converged on
 * the fix: carry NO cursor across rounds. Every round re-fetches each
 * selected lead's newest `windowSize` (<= MAX_LIMIT) entries from
 * `before: 0` (the stable front of the stream) via the EXISTING,
 * unmodified per-lead route, and this module merges the freshly-fetched
 * windows. Self-healing under concurrent writes by construction: there is
 * no stale position to desync.
 *
 * Why fetching `windowSize` from every lead, every round, is sufficient: a
 * merged output of size M can contain at most M entries from any ONE lead
 * (the whole output only has M slots), so once `windowSize >= M` for every
 * lead, nothing beyond what's already fetched could ever appear in the
 * merged top-M. No speculative re-fetching is ever needed within a round.
 */

import type { AuditLogEntry, AuditLogPage } from "./orgApi";

// Mirrors DEFAULT_LIMIT/MAX_LIMIT in server/src/external/org/audit-log.ts —
// the server clamps `limit` regardless, but keep these in sync so the
// client's "hit the ceiling" messaging matches what the server will serve.
export const DEFAULT_WINDOW = 50;
export const MAX_WINDOW = 200;

export interface AuditTimelineRow {
  leadId: string;
  entry: AuditLogEntry;
  /** Epoch ms if `entry.parsed.ts` parsed cleanly, else `null` — a `null`
   *  row always sorts after every timestamped row (see `sortKeyFor`). */
  tsMs: number | null;
  /** Position within this lead's freshly-fetched window (0 = newest
   *  fetched). Used only to break ties deterministically. */
  index: number;
}

export interface AuditTimelineFilters {
  /** Only these leads are considered. Omit/empty = every fetched lead. */
  leadIds?: string[];
  /** Only these `parsed.kind` values pass. Omit/empty = every kind. */
  eventTypes?: string[];
  /** Inclusive lower bound, epoch ms. */
  sinceMs?: number;
  /** Inclusive upper bound, epoch ms. Inclusive (not exclusive) so a "Last
   *  night" window stated as "...-> today 06:00" doesn't silently drop an
   *  entry logged at exactly 06:00:00.000 (external-review finding). */
  untilMs?: number;
}

function parseTsMs(entry: AuditLogEntry): number | null {
  if (!entry.parsed) return null;
  const raw = entry.parsed.ts;
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function kindOf(entry: AuditLogEntry): string | null {
  const kind = entry.parsed?.kind;
  return typeof kind === "string" ? kind : null;
}

function matchesFilters(row: AuditTimelineRow, filters: AuditTimelineFilters): boolean {
  if (filters.leadIds && filters.leadIds.length > 0 && !filters.leadIds.includes(row.leadId)) {
    return false;
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    const kind = kindOf(row.entry);
    if (kind === null || !filters.eventTypes.includes(kind)) return false;
  }
  if (filters.sinceMs !== undefined) {
    // An entry with no timestamp can never be confirmed inside a time
    // window — excluded from a time-filtered view rather than guessed in.
    if (row.tsMs === null || row.tsMs < filters.sinceMs) return false;
  }
  if (filters.untilMs !== undefined) {
    if (row.tsMs === null || row.tsMs > filters.untilMs) return false;
  }
  return true;
}

/**
 * Descending sort key: numeric epoch ms (never lexicographic ISO-string
 * compare — mixed millisecond precision breaks that, e.g. `"...:00.5Z"`
 * sorts lexicographically BEFORE `"...:00Z"` despite being 500ms later).
 * A `null` timestamp maps to `NEGATIVE_INFINITY`, so it always loses the
 * descending `bKey - aKey` compare and sorts after every valid timestamp;
 * ties break by `(leadId, index)` for a stable, reproducible order.
 */
function compareRowsNewestFirst(a: AuditTimelineRow, b: AuditTimelineRow): number {
  const aKey = a.tsMs ?? Number.NEGATIVE_INFINITY;
  const bKey = b.tsMs ?? Number.NEGATIVE_INFINITY;
  if (aKey !== bKey) return bKey - aKey; // newest (largest ms) first
  if (a.leadId !== b.leadId) return a.leadId < b.leadId ? -1 : 1;
  return a.index - b.index;
}

function collectFilteredRows(
  perLeadPages: Record<string, AuditLogPage | undefined>,
  filters: AuditTimelineFilters,
): AuditTimelineRow[] {
  const rows: AuditTimelineRow[] = [];
  for (const [leadId, page] of Object.entries(perLeadPages)) {
    if (!page) continue;
    page.entries.forEach((entry, index) => {
      rows.push({ leadId, entry, tsMs: parseTsMs(entry), index });
    });
  }
  return rows.filter((row) => matchesFilters(row, filters));
}

/**
 * Merge every selected lead's freshly-fetched page into one filtered,
 * time-sorted (newest first) list, capped at `windowSize`. Stateless: pass
 * the SAME `perLeadPages` (from `before: 0` fetches) every round — there is
 * no cursor to carry between calls.
 */
export function mergeAuditTimelineEntries(
  perLeadPages: Record<string, AuditLogPage | undefined>,
  filters: AuditTimelineFilters,
  windowSize: number,
): AuditTimelineRow[] {
  const filtered = collectFilteredRows(perLeadPages, filters);
  filtered.sort(compareRowsNewestFirst);
  return filtered.slice(0, Math.min(windowSize, MAX_WINDOW));
}

/** true if growing `windowSize` further could reveal more matching rows.
 *  Two independent causes, both checked (external-review finding: checking
 *  only the first one under-reports): (1) a lead's fetched page is exactly
 *  full — its file may hold more entries than were fetched — or (2) the
 *  COMBINED filtered total across all leads already exceeds `windowSize`,
 *  meaning `mergeAuditTimelineEntries`'s own slice is silently dropping
 *  rows right now even though no single lead's page is individually
 *  saturated (e.g. 2 leads x 30 entries each, windowSize=50 -> 60 filtered
 *  rows, 10 silently sliced away, yet neither page.length >= 50). */
export function hasMoreToLoad(
  perLeadPages: Record<string, AuditLogPage | undefined>,
  filters: AuditTimelineFilters,
  windowSize: number,
): boolean {
  if (windowSize >= MAX_WINDOW) {
    // At the ceiling: "more" is only meaningful if there's more filtered
    // data than the ceiling can show — but growing further is impossible,
    // so report the ceiling instead of "more" (the caller renders the
    // ceiling notice as the reachable action; there is nothing further
    // "Load more" itself can do).
    return false;
  }
  const perLeadSaturated = Object.values(perLeadPages).some(
    (page) => page && page.entries.length >= windowSize,
  );
  if (perLeadSaturated) return true;
  return collectFilteredRows(perLeadPages, filters).length > windowSize;
}

export function isAtWindowCeiling(
  perLeadPages: Record<string, AuditLogPage | undefined>,
  filters: AuditTimelineFilters,
  windowSize: number,
): boolean {
  if (windowSize < MAX_WINDOW) return false;
  const perLeadSaturated = Object.values(perLeadPages).some(
    (page) => page && page.entries.length >= MAX_WINDOW,
  );
  if (perLeadSaturated) return true;
  return collectFilteredRows(perLeadPages, filters).length > MAX_WINDOW;
}

/** "Last night" preset: yesterday 18:00 local -> today 06:00 local, the
 *  most recently COMPLETED such interval — if `now` is itself before
 *  06:00, that means the interval ending at TODAY's 06:00 has not
 *  completed yet, so the window is the PRIOR day's (day-before-yesterday
 *  18:00 -> yesterday 06:00) instead of reaching into the future. */
export function computeLastNightWindow(now: Date): { sinceMs: number; untilMs: number } {
  const today06 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0);
  const untilAnchor = now < today06 ? new Date(today06.getTime() - 86_400_000) : today06;
  const sinceAnchor = new Date(
    untilAnchor.getFullYear(),
    untilAnchor.getMonth(),
    untilAnchor.getDate() - 1,
    18,
    0,
    0,
    0,
  );
  return { sinceMs: sinceAnchor.getTime(), untilMs: untilAnchor.getTime() };
}
