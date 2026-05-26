/*
 * external/inbox/_cache.ts — per-session inbox derive cache + negative-result
 * cache. Extracted from the historical routes.ts during the C2 split.
 *
 * Iterate 3 remediation — Phase A4 (BUG 3 fix, 2026-04-20).
 *
 * `/api/external/inbox` used to re-parse the entire JSONL for every
 * tracked task on every request (9–10 s latency against 216 sessions
 * observed in UAT). The cache below memoizes the derived pending set
 * keyed by `(sessionUuid, mtimeMs, dismissedKey, contentLength)`.
 *
 * - mtimeMs change (new events written) busts the cache naturally.
 * - dismissedKey busts the cache when the user dismisses an entry so
 *   the next inbox call reflects the reduced pending set.
 * - contentLength captures the `lastProcessedByteOffset` we persist to
 *   the store, so callers see a coherent pair.
 *
 * Pattern mirrors `core/project-actions-loader.ts:52-68`. No explicit
 * invalidation needed; the key tuple naturally covers all cases.
 *
 * Module-scoped singletons — shared between the shell (which used to
 * own them) and the inbox/routes.ts handlers. Sibling test files
 * continue to import `clearInboxDeriveCache` from `./routes.js` via the
 * shell's re-export.
 */

export interface InboxDeriveCacheEntry {
  /** Resolved on-disk path — lets us `stat()` directly on warm calls
   *  instead of rescanning every subdir of ~/.claude/projects via
   *  findByUuid (the actual hot-spot — the JSONL parse is cheap by
   *  comparison). Falls back to findByUuid on stat failure. */
  resolvedPath: string;
  mtimeMs: number;
  contentLength: number;
  dismissedKey: string;
  /**
   * Cached inbox rows for this session. Discriminated union (iterate
   * 2026-05-15 inbox-awaiting-user): `ask_tool` is an unanswered
   * AskUserQuestion tool_use; `text_question` is a plain-text end-of-turn
   * question detected by `detectAwaitingUserQuestion`. Text questions carry
   * NO tool fields — they auto-clear on the next user turn (no dismiss).
   */
  entries: Array<
    | {
        kind: "ask_tool";
        toolUseId: string;
        toolName: string;
        input: unknown;
        taskTitle: string;
      }
    | {
        kind: "text_question";
        questionId: string;
        questionText: string;
        taskTitle: string;
      }
  >;
  pendingIds: string[];
}

export const inboxDeriveCache = new Map<string, InboxDeriveCacheEntry>();

/**
 * Negative-result cache for `findByUuid` misses (Phase A4). Sessions
 * that haven't materialized on disk yet (e.g. `awaiting_external_start`
 * tasks where the user hasn't pasted the launch command) previously
 * triggered a full readdir scan across every subdirectory of
 * `~/.claude/projects` on EVERY inbox call — the dominant latency
 * source (60+ sessions × 216 subdir scans).
 *
 * With a short TTL we skip the scan for sessions we recently confirmed
 * don't exist. The TTL is intentionally short so launch → discovery
 * still converges quickly (~15 s worst case).
 */
export const NEGATIVE_RESULT_TTL_MS = 15_000;
export const inboxNegativeCache = new Map<string, number>();

/** Test helper — drops the per-session inbox caches. */
export function clearInboxDeriveCache(): void {
  inboxDeriveCache.clear();
  inboxNegativeCache.clear();
}
