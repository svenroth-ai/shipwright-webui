/*
 * triage-amend.ts — TS port of `lib/triage_amend.py`: the `amend` event's
 * vocabulary, validation, and the Pass-2 overlay applied to a resolved
 * triage item.
 *
 * iterate-2026-08-08-triage-amend-reader. A card's `title`/`detail`/
 * `severity`/`kind` can be corrected in place — id stable — instead of
 * dismiss-and-refile. NOT amendable: `source`, `dedupKey`, `runId`,
 * `evidencePath`, `commit`, `launchPayload`, `frId`, `suiteId`, `eventId`,
 * `status` (status stays exclusively a `status` event).
 *
 * Split out of `triage-store.ts` for the same reason the Python side split
 * out of `triage.py`: that module is already at its documented
 * bloat-baseline ceiling with little headroom (see `triage-store.ts`'s own
 * header) — mirroring the Python module boundary keeps the two languages'
 * structure congruent for this cross-language contract.
 *
 * Whole-event validation, never partial application: `validateAmendEvent`
 * checks every field PRESENT on a raw event; if any present field is
 * invalid, the caller skips the WHOLE event (mirrors the existing
 * convention for a damaged `status` event in `triage-store.ts`). A field
 * ABSENT from an amend is simply not applied, leaving the target unchanged.
 */

import type { TriageKind, TriagePriority, TriageSeverity } from "../types/triage.js";

/** Fields an `amend` event may correct. */
export const AMENDABLE_FIELDS = ["title", "detail", "severity", "kind"] as const;

/** Resolved-item keys carrying who/when the item was last amended. */
export const AMENDED_BY_FIELD = "amendedBy";
export const AMENDED_AT_FIELD = "amendedAt";

const SEVERITY_VALUES: ReadonlySet<TriageSeverity> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
const KIND_VALUES: ReadonlySet<TriageKind> = new Set([
  "bug",
  "feature",
  "improvement",
  "compliance",
  "maintenance",
]);
const PRIORITY_FROM_SEVERITY: Record<TriageSeverity, TriagePriority> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
  info: "P3",
};

/** Pure: severity → P0..P3. Mirrors `triage_fields.suggest_priority_from_severity`. */
export function suggestPriorityFromSeverity(severity: TriageSeverity): TriagePriority {
  return PRIORITY_FROM_SEVERITY[severity];
}

/**
 * True iff every field PRESENT on `raw` is well-typed and, for the two
 * closed-vocabulary fields, a member of the current vocabulary. Does NOT
 * check for contentless amends — that is a writer-side precondition, not a
 * resolver concern (a stored line already on disk only has its field
 * VALIDITY in question by the time a reader sees it).
 */
export function validateAmendEvent(raw: Record<string, unknown>): boolean {
  if ("title" in raw) {
    const title = raw.title;
    if (typeof title !== "string" || !title.trim()) return false;
  }
  if ("detail" in raw && typeof raw.detail !== "string") return false;
  if ("severity" in raw && !SEVERITY_VALUES.has(raw.severity as TriageSeverity)) return false;
  if ("kind" in raw && !KIND_VALUES.has(raw.kind as TriageKind)) return false;
  return true;
}

/**
 * Overlay a VALIDATED amend event onto a resolved item, in place. Caller
 * must have already confirmed `validateAmendEvent(raw)` — an invalid amend
 * is the caller's responsibility to skip in its entirety, never partially
 * applied here.
 *
 * `item.ts` is deliberately NOT overlaid — it keeps meaning "time of the
 * last STATUS decision", exactly as before this event type existed.
 */
export function applyAmend(item: Record<string, unknown>, raw: Record<string, unknown>): void {
  if ("title" in raw) item.title = raw.title;
  if ("detail" in raw) item.detail = raw.detail;
  if ("severity" in raw) {
    item.severity = raw.severity;
    item.suggestedPriority = suggestPriorityFromSeverity(raw.severity as TriageSeverity);
  }
  if ("kind" in raw) item.kind = raw.kind;
  const rawBy = raw.by;
  const rawTs = raw.ts;
  item[AMENDED_BY_FIELD] = typeof rawBy === "string" ? rawBy : null;
  item[AMENDED_AT_FIELD] = typeof rawTs === "string" ? rawTs : null;
}

/**
 * Validate-then-overlay in one call for the `resolveUnion` Pass 2 dispatch:
 * an invalid `raw` is skipped WHOLE (no-op on `item`), never partially
 * applied.
 */
export function tryApplyAmend(item: Record<string, unknown>, raw: Record<string, unknown>): void {
  if (validateAmendEvent(raw)) applyAmend(item, raw);
}
