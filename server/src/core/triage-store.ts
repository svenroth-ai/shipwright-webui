/*
 * triage-store.ts — TS port of `triage.read_all_items` from
 * `shared/scripts/triage.py`. Pure read path; status flips go through
 * `triage-write.ts`. Raw JSONL line reading lives in `triage-raw.ts`.
 *
 * UNION read (campaign 2026-06-08-triage-outbox-delivery / D1): the
 * resolved view sources the tracked `triage.jsonl` AND the per-tree,
 * gitignored `triage.outbox.jsonl` buffer (idle-main background producers
 * append there, never the tracked store). Reading the union keeps those
 * findings visible in the live Inbox without waiting for the D2
 * sweep+merge round-trip. Raw lines are concatenated tracked-THEN-outbox
 * (file order); resolution is by id, so a line present in both (post-sweep,
 * pre-GC) collapses to one item.
 *
 * Two-pass resolution (matches Python read_all_items):
 *   - Pass 1 applies ALL `append` events (base records, union of both files)
 *   - Pass 2 applies ALL `status` AND `amend` events TOGETHER, ordered by
 *     (ts, file-order): ts is primary so the chronologically-later event in
 *     EITHER file wins REGARDLESS OF EVENT TYPE; file order (tracked-before-
 *     outbox) is the stable tiebreaker for equal ts, preserving the
 *     single-file "later valid line wins by file order" contract. The
 *     append-first split stops an outbox append (status:triage) from
 *     clobbering a tracked status flip. Each event type keeps its own
 *     overlay semantics (status: whole-field replace; amend: only present
 *     fields, via `triage-amend.ts tryApplyAmend`) — interleaving them by
 *     time is what makes two amends ACCUMULATE (each is a merge) while a
 *     later status still fully supersedes an earlier one (iterate-2026-08-08-
 *     triage-amend-reader; byte-for-byte mirror of `triage.py`
 *     read_all_items` Pass 2, which loops one combined sorted list rather
 *     than two separate passes).
 *   - status overlay sets: status, ts, statusBy, statusReason, revisitAt
 *   - promotedTaskId only set when the status event carries a non-null value
 *   - amend overlay sets: title/detail/severity/kind (present fields only),
 *     suggestedPriority (on a severity amend), amendedBy, amendedAt — never
 *     `ts`, which stays "time of the last STATUS decision"
 *
 * Park-expiry overlay (monorepo P2.03, iterate-2026-08-05-triage-deferred-
 * envelope): `applyDeferOverlay` (triage-defer.ts) runs exactly ONCE, right
 * after the two-pass resolution, mirroring where Python's `read_all_items`
 * applies `_defer.apply_revisit_expiry` — never re-applied to its own output
 * (see triage-defer.ts's module header for why that matters).
 *
 * Cache (5 s soft TTL) keyed by the tracked path, keyed on BOTH the tracked
 * AND outbox mtimes — a change to either file invalidates. Forced eviction
 * via invalidateCacheForPath() (called from triage-write.ts).
 *
 * The overlay result depends on wall-clock time, not just file bytes, so a
 * cache hit alone cannot answer "is this still correct" — a park's due day
 * can turn over WITHIN the 5 s TTL with neither file touched (doubt review,
 * iterate-2026-08-05-triage-deferred-envelope). Each entry therefore also
 * remembers `overlayDay` (the UTC calendar day `items` was computed for): a
 * cache hit on the SAME day returns `items` unchanged (identical array
 * reference — the pre-overlay `rawItems` are never re-mapped); a hit whose
 * day has turned over re-applies `applyDeferOverlay` to the SAME `rawItems`
 * (no re-read, no re-parse) and remembers the new day. This keeps the
 * common case free (one .map() at most once per calendar day per path)
 * while never serving a stale-by-more-than-nothing due-state.
 */

import { statSync } from "node:fs";

import type { TriageItem, TriageStatus } from "../types/triage.js";
import { AMENDED_AT_FIELD, AMENDED_BY_FIELD, tryApplyAmend } from "./triage-amend.js";
import { applyDeferOverlay, utcToday } from "./triage-defer.js";
import { readRawLines } from "./triage-raw.js";
import { outboxPathFor } from "./triage-paths.js";

export { parseRawLines, readLocalRawLinesSplit } from "./triage-raw.js";

const STATUSES: ReadonlySet<TriageStatus> = new Set([
  "triage",
  "promoted",
  "dismissed",
  "snoozed",
]);

interface CacheEntry {
  /** mtime of the tracked `triage.jsonl`, or null when absent. */
  trackedMtimeMs: number | null;
  /** mtime of the per-tree `triage.outbox.jsonl`, or null when absent. */
  outboxMtimeMs: number | null;
  filledAt: number;
  /** Pre-overlay `resolveUnion` output — a pure function of file bytes. */
  rawItems: TriageItem[];
  /** UTC calendar day (`YYYY-MM-DD`) the current `items` was overlaid for. */
  overlayDay: string;
  items: TriageItem[];
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

/** Forced cache eviction — called by triage-write.ts after a successful append. */
export function invalidateCacheForPath(path: string): void {
  cache.delete(path);
}

/** Test-only — clear the entire cache. Exported so vitest setup can isolate runs. */
export function _clearCache_TEST_ONLY(): void {
  cache.clear();
}

/** mtime in ms, or null when the file is absent / unstat-able. */
function mtimeOrNull(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/** ISO-8601-Z string sort key; non-string/missing ts sorts EARLIEST (""). */
function tsKey(raw: Record<string, unknown>): string {
  const ts = raw.ts;
  return typeof ts === "string" ? ts : "";
}

/**
 * Two-pass union resolution over already-parsed raw lines (tracked THEN
 * outbox, file order). Byte-for-byte mirror of Python `read_all_items`'s
 * resolution body — Pass 1 applies all `append` events, Pass 2 applies all
 * `status` AND `amend` events together, ordered by (ts, file-order).
 *
 * Exported for the delivered-origin composer (`triage-compose.ts`): the same
 * multi-source union already reconciles tracked ∪ outbox, so adding origin as
 * a third raw-line source is a natural extension resolved by identical rules.
 */
export function resolveUnion(rawLines: Record<string, unknown>[]): TriageItem[] {
  // Pass 1 — every append establishes a base record (union of both files).
  // A duplicate append for the same id (post-sweep, pre-GC) collapses to one
  // record; the later line's fields win (identical content → harmless).
  const resolved = new Map<string, Record<string, unknown>>();
  for (const raw of rawLines) {
    if (raw.event !== "append") continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    const item: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k === "event") continue;
      item[k] = v;
    }
    item.statusBy = null;
    item.statusReason = null;
    item.promotedTaskId = null;
    // Revisit semantics belong only to a valid `snoozed` status event — a
    // hand-edited append must not acquire park semantics (mirrors Python).
    item.revisitAt = null;
    item[AMENDED_BY_FIELD] = null;
    item[AMENDED_AT_FIELD] = null;
    resolved.set(id, item);
  }

  // Pass 2 — overlay status flips AND amends TOGETHER, ordered by
  // (ts, file-order). ts is primary so a chronologically-later event in
  // EITHER file wins regardless of type; the enumerate index is the stable
  // tiebreaker for equal ts (tracked precedes outbox).
  const statusAndAmendEvents: { idx: number; raw: Record<string, unknown> }[] = [];
  rawLines.forEach((raw, idx) => {
    if (raw.event === "status" || raw.event === "amend") statusAndAmendEvents.push({ idx, raw });
  });
  statusAndAmendEvents.sort((a, b) => {
    const ta = tsKey(a.raw);
    const tb = tsKey(b.raw);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return a.idx - b.idx;
  });
  for (const { raw } of statusAndAmendEvents) {
    const id = raw.id;
    if (typeof id !== "string") continue;
    const item = resolved.get(id);
    if (!item) continue; // status/amend for unknown id (corrupt / out-of-order) — skip

    if (raw.event === "amend") {
      tryApplyAmend(item, raw);
      continue;
    }

    const newStatus = raw.newStatus;
    if (typeof newStatus === "string" && STATUSES.has(newStatus as TriageStatus)) {
      item.status = newStatus;
    }
    // Per-field overlay is byte-identical to the pre-union single-pass port
    // (AC5: existing single-file behavior unchanged). The ONLY new behavior
    // is the union source + the (ts, file-order) ordering above — NOT the
    // per-line overlay semantics. The typeof guards also keep the webui's
    // stricter `TriageItem` type contract (ts: string; promotedTaskId:
    // string | null) intact for malformed-but-tolerated status events, where
    // Python's verbatim `raw.get(...)` would leak a non-string through.
    const overlayTs = raw.ts;
    if (typeof overlayTs === "string") {
      item.ts = overlayTs;
    }
    item.statusBy = (raw.by as string | null | undefined) ?? null;
    item.statusReason = (raw.reason as string | null | undefined) ?? null;
    // A valid `snoozed` flip takes its supplied revisit date; any other flip
    // (un-park/dismiss/promote) clears it, even if a hand-edited event
    // illegally carries park semantics on a non-snoozed status.
    const revisit = raw.revisitAt;
    item.revisitAt =
      newStatus === "snoozed" && typeof revisit === "string" ? revisit : null;
    const promoted = raw.promotedTaskId;
    // Only a non-null promotedTaskId overrides (null/absent keep the prior
    // value); non-strings are coerced to preserve the string|null contract.
    if (promoted !== undefined && promoted !== null) {
      item.promotedTaskId =
        typeof promoted === "string" ? promoted : String(promoted);
    }
  }

  return Array.from(resolved.values()) as unknown as TriageItem[];
}

/**
 * Read and resolve every triage item for a project, sourcing the UNION of
 * the tracked store (`trackedPath`) and the per-tree outbox buffer alongside
 * it. Returns [] when neither file exists (so consumers need no separate
 * existence check).
 *
 * `trackedPath` is the absolute tracked `triage.jsonl` path (from
 * `resolveTriagePath().absolute`); the outbox sibling is derived via
 * `outboxPathFor`.
 */
export function readAllItems(trackedPath: string): TriageItem[] {
  const outboxPath = outboxPathFor(trackedPath);
  const trackedMtimeMs = mtimeOrNull(trackedPath);
  const outboxMtimeMs = mtimeOrNull(outboxPath);

  // Neither file present — no triage store at all.
  if (trackedMtimeMs === null && outboxMtimeMs === null) return [];

  const now = new Date();
  const today = utcToday(now);

  // Dual-mtime cache lookup (keyed by the tracked path).
  const cached = cache.get(trackedPath);
  if (
    cached &&
    cached.trackedMtimeMs === trackedMtimeMs &&
    cached.outboxMtimeMs === outboxMtimeMs &&
    Date.now() - cached.filledAt < CACHE_TTL_MS
  ) {
    if (cached.overlayDay === today) return cached.items;
    // Same bytes, but the UTC day turned over since the cache filled — the
    // overlay is a pure function of (rawItems, today), so re-apply it to
    // the ALREADY-PARSED rawItems (no re-read, no re-parse) rather than
    // serving a due-state that's stale by more than nothing.
    cached.items = applyDeferOverlay(cached.rawItems, now);
    cached.overlayDay = today;
    return cached.items;
  }

  // Tolerant union read: tracked lines THEN outbox lines (file order).
  const rawLines = [...readRawLines(trackedPath), ...readRawLines(outboxPath)];
  const rawItems = resolveUnion(rawLines);
  const items = applyDeferOverlay(rawItems, now);

  cache.set(trackedPath, {
    trackedMtimeMs,
    outboxMtimeMs,
    filledAt: Date.now(),
    rawItems,
    overlayDay: today,
    items,
  });
  return items;
}

/**
 * Set of `append`-event ids in ONE file (residence probe for the
 * residence-derived status write in triage-write.ts). Mirrors Python
 * `_append_ids_at`. Tolerant — skips corrupt lines.
 */
export function appendIdsInFile(jsonlPath: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of readRawLines(jsonlPath)) {
    if (raw.event === "append" && typeof raw.id === "string") {
      ids.add(raw.id);
    }
  }
  return ids;
}

/** Convenience: filter to active triage status. */
export function filterTriage(items: TriageItem[]): TriageItem[] {
  return items.filter((it) => it.status === "triage");
}

/**
 * Find a single item by id (linear scan). Used by the route layer for
 * existence + status checks.
 */
export function findItemById(
  items: TriageItem[],
  id: string,
): TriageItem | undefined {
  return items.find((it) => it.id === id);
}
