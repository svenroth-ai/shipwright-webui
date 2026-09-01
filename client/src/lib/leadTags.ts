/*
 * Lead task tag vocabulary — FR-04.10 in leadwright/spec/lead-model-spec.md
 * (canonical source, separate repo). Exactly three tag prefixes exist and
 * this module MUST NOT invent a fourth: `lead:<lead-id>` (origin — which
 * helper created the card), `lead-wait:po` (waiting on the PO) and
 * `lead-dedup:<key>` (idempotency key). `domain`, `priority`,
 * `complexityHint` and `tags` are already-persisted ExternalTask fields
 * (iterate-2026-05-14-lead-foundation-task-schema) — nothing here derives
 * or writes them, it only reads and matches.
 *
 * All helpers accept `tags?: string[] | null` and treat anything that
 * isn't a non-empty array as "no tags" — a legacy/mocked ExternalTask
 * record must never throw the board render (iterate-2026-09-01-lead-board-
 * surface, external plan review).
 */

export const LEAD_ORIGIN_TAG_PREFIX = "lead:";
export const LEAD_WAIT_TAG_PREFIX = "lead-wait:";
export const LEAD_DEDUP_TAG_PREFIX = "lead-dedup:";

export const LEAD_TAG_PREFIXES = [
  LEAD_ORIGIN_TAG_PREFIX,
  LEAD_WAIT_TAG_PREFIX,
  LEAD_DEDUP_TAG_PREFIX,
] as const;

export type LeadTagPrefix = (typeof LEAD_TAG_PREFIXES)[number];

function safeTags(tags?: string[] | null): string[] {
  return Array.isArray(tags) ? tags : [];
}

/** The single null/element-safe primitive every predicate below routes
 *  through — a malformed element (non-string, from a legacy/mocked record)
 *  is skipped rather than thrown on. Exported for callers (board filter
 *  counts) that need a single-prefix check without an array allocation. */
export function hasPrefix(tags: string[] | undefined | null, prefix: string): boolean {
  return safeTags(tags).some((t) => typeof t === "string" && t.startsWith(prefix));
}

function firstWithPrefix(tags: string[] | undefined | null, prefix: string): string | null {
  const tag = safeTags(tags).find((t) => typeof t === "string" && t.startsWith(prefix));
  return typeof tag === "string" ? tag.slice(prefix.length) : null;
}

/** True when the task carries a `lead:` origin tag — the ONLY prefix the
 *  board glyph gates on (never the broader `hasAnyLeadTag`). */
export function isLeadOriginated(tags?: string[] | null): boolean {
  return hasPrefix(tags, LEAD_ORIGIN_TAG_PREFIX);
}

export function isWaitingOnPo(tags?: string[] | null): boolean {
  return hasPrefix(tags, LEAD_WAIT_TAG_PREFIX);
}

export function hasDedupTag(tags?: string[] | null): boolean {
  return hasPrefix(tags, LEAD_DEDUP_TAG_PREFIX);
}

/** True when the task carries any of the three lead tag prefixes. Used for
 *  board filtering and the expander's render-gate — never for the glyph. */
export function hasAnyLeadTag(tags?: string[] | null): boolean {
  return LEAD_TAG_PREFIXES.some((prefix) => hasPrefix(tags, prefix));
}

/** True when `tags` has at least one tag starting with any prefix in
 *  `prefixes` — the OR-within-group semantics the board filter uses. Narrowed
 *  to the closed vocabulary: this module's whole premise is that no fourth
 *  prefix exists, so the type system should refuse one too. */
export function matchesAnyLeadPrefix(
  tags: string[] | undefined | null,
  prefixes: Iterable<LeadTagPrefix>,
): boolean {
  for (const prefix of prefixes) {
    if (hasPrefix(tags, prefix)) return true;
  }
  return false;
}

/** The lead id from a `lead:<lead-id>` tag, or null. First match wins. */
export function leadOriginId(tags?: string[] | null): string | null {
  return firstWithPrefix(tags, LEAD_ORIGIN_TAG_PREFIX);
}

/** The dedup key from a `lead-dedup:<key>` tag, or null. First match wins. */
export function dedupKey(tags?: string[] | null): string | null {
  return firstWithPrefix(tags, LEAD_DEDUP_TAG_PREFIX);
}
