/*
 * external/org/beat-effect-audit-read.ts — per-lead lookup of which beats
 * carry an unclaimed-effect audit entry (iterate-2026-09-08-lead-inventory-
 * page, AC-2a/AC-9). Wraps the existing `auditLogCore` (`audit-log.ts`)
 * rather than re-implementing the open-first read.
 *
 * `auditLogCore(limit:200)` alone was found by BOTH external reviewers to
 * risk a false `{status:"clear"}`: a `beat_effect_not_claimed` entry older
 * than the newest 200 audit lines would simply never be seen. Fixed by
 * paging with the `before` cursor until either every entry back to the 48h
 * beat-window start is covered, or a bounded cap of 10 pages (2000 entries)
 * is hit — the cap degrades the WHOLE lookup to `{status:"unknown"}` for
 * every beat in the bounded set, never a silent miss (AC-9). A malformed
 * JSONL line (`entry.parsed === null`) is skipped, not fatal to the page.
 *
 * A genuinely absent `audit.jsonl` (404 — the lead has never had an
 * unclaimed-effect entry logged) is legitimately `{status:"ok", empty Set}`
 * — a real "clear", not a degrade. Any other read failure (bad leadId,
 * symlink, fs error) degrades to `unknown`.
 */

import { auditLogCore, type AuditLogCoreResult, type AuditLogDeps, type AuditLogParams } from "./audit-log.js";

const UNCLAIMED_EFFECT_KIND = "beat_effect_not_claimed";
const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

export type BeatEffectAuditResult =
  | { status: "ok"; unclaimedBeatIds: Set<string> }
  | { status: "unknown" };

export interface BeatEffectAuditDeps extends AuditLogDeps {
  /** Test seam — defaults to the real `auditLogCore`. */
  auditLogFn?: (deps: AuditLogDeps, params: AuditLogParams) => AuditLogCoreResult;
}

function entryTimestampMs(parsed: Record<string, unknown> | null): number {
  if (!parsed || typeof parsed.ts !== "string") return NaN;
  return Date.parse(parsed.ts);
}

/** Pure core. `windowStartMs` is the 48h beat-window start (epoch ms) the
 *  composite computes once per request. */
export function readBeatEffectAuditCore(
  deps: BeatEffectAuditDeps,
  leadId: string,
  windowStartMs: number,
): BeatEffectAuditResult {
  const auditLogFn = deps.auditLogFn ?? auditLogCore;
  const unclaimedBeatIds = new Set<string>();
  let before = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = auditLogFn(deps, { leadId, before, limit: PAGE_LIMIT });

    if (result.status === 404) {
      return { status: "ok", unclaimedBeatIds };
    }
    if (result.status !== 200) {
      return { status: "unknown" };
    }

    for (const entry of result.body.entries) {
      const parsed = entry.parsed;
      if (!parsed) continue;
      if (parsed.kind === UNCLAIMED_EFFECT_KIND && typeof parsed.beat_id === "string") {
        unclaimedBeatIds.add(parsed.beat_id);
      }
    }

    const oldestOnPage = result.body.entries[result.body.entries.length - 1];
    const oldestTs = oldestOnPage ? entryTimestampMs(oldestOnPage.parsed) : NaN;
    const coveredWindow = Number.isFinite(oldestTs) && oldestTs <= windowStartMs;

    if (result.body.nextCursor === null || coveredWindow) {
      return { status: "ok", unclaimedBeatIds };
    }
    before = result.body.nextCursor;
  }

  return { status: "unknown" };
}
