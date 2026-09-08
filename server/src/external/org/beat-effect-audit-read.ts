/*
 * external/org/beat-effect-audit-read.ts — per-lead lookup of which beats
 * carry an unclaimed-effect audit entry (iterate-2026-09-08-lead-inventory-
 * page, AC-2a/AC-9). Wraps `readAuditLinesGuarded` (`audit-log.ts`) rather
 * than re-implementing the open-first read.
 *
 * Reads `audit.jsonl` in ONE pass, not page-by-page. The first version of
 * this file called the paginated `auditLogCore` in a bounded loop
 * (`before`-cursor, up to 10 pages) to avoid a false `{status:"clear"}` from
 * only ever seeing the newest 200 lines — but `auditLogCore` re-reads and
 * re-reverses the WHOLE file on every call (its own header discloses that
 * whole-file-read cost as accepted for a single page); looping it therefore
 * multiplied an already-accepted cost by up to 10x per lead per request
 * (code review, Stage 2). A single full-file scan removes the multiplier
 * AND the truncation risk in the same change: there is no page boundary to
 * fall short of, so coverage is complete by construction and a genuine read
 * failure is the only thing left that can produce `{status:"unknown"}`. The
 * read is ATOMIC (one `readFileSync`), so there is no genuine mid-scan
 * partial-failure state — it either fully succeeds (`unclaimedBeatIds`
 * complete) or fully fails (`unknown`, `unclaimedBeatIds` empty). The
 * caller (`org-inventory-composite.ts`) still checks `unclaimedBeatIds`
 * BEFORE `status`, which is what would keep a "found" entry monotone if a
 * future version of this reader ever did support a partial/incremental
 * result — external code review correction: an earlier version of this
 * comment described that as a live guarantee against a scenario this
 * design cannot currently produce.
 *
 * A genuinely absent `audit.jsonl` (404 — the lead has never had an
 * unclaimed-effect entry logged) is legitimately `{status:"ok", empty Set}`
 * — a real "clear", not a degrade. Any other read failure (bad leadId,
 * symlink, fs error) degrades to `unknown`. A malformed JSONL line is
 * skipped, not fatal to the scan.
 *
 * Known limitation, stated rather than hidden (doubt review, medium/
 * concurrency): the scan is synchronous Node fs, called once per lead
 * inside `org-inventory-composite.ts`'s per-lead loop, on the single JS
 * event loop — a large `audit.jsonl` blocks the whole server for the scan's
 * duration, same as `audit-log.ts`'s own disclosed whole-file-read cost.
 * Accepted for this iterate's scale (a single local operator's roster,
 * `useLeadInventory` polling every 5 minutes — see
 * `LEADS_USAGE_REFRESH_INTERVAL_MS`), same as `readAuditLinesGuarded`'s own
 * accepted whole-file-read cost; a size/line-count ceiling degrading to
 * `unknown` on breach is the natural follow-up if a lead's audit history
 * ever grows large enough to make this measurably slow.
 */

import { readAuditLinesGuarded, type AuditLogDeps } from "./audit-log.js";

const UNCLAIMED_EFFECT_KIND = "beat_effect_not_claimed";

export type BeatEffectAuditResult =
  | { status: "ok"; unclaimedBeatIds: Set<string> }
  | { status: "unknown"; unclaimedBeatIds: Set<string> };

export interface BeatEffectAuditDeps extends AuditLogDeps {
  /** Test seam — defaults to the real `readAuditLinesGuarded`. */
  readAuditLinesFn?: typeof readAuditLinesGuarded;
}

/** Pure core — single full-file scan of a lead's `audit.jsonl`. */
export function readBeatEffectAuditCore(deps: BeatEffectAuditDeps, leadId: string): BeatEffectAuditResult {
  const readFn = deps.readAuditLinesFn ?? readAuditLinesGuarded;
  const read = readFn(deps, leadId);

  if (read.status === 404) {
    return { status: "ok", unclaimedBeatIds: new Set() };
  }
  if (read.status !== 200) {
    return { status: "unknown", unclaimedBeatIds: new Set() };
  }

  const unclaimedBeatIds = new Set<string>();
  for (const raw of read.linesNewestFirst) {
    let parsed: Record<string, unknown> | null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed.kind === UNCLAIMED_EFFECT_KIND && typeof parsed.beat_id === "string") {
      unclaimedBeatIds.add(parsed.beat_id);
    }
  }

  return { status: "ok", unclaimedBeatIds };
}
