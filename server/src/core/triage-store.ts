/*
 * triage-store.ts — TS port of `triage.read_all_items` from
 * `shared/scripts/triage.py`. Pure read path; status flips go through
 * `triage-write.ts`.
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
 * Tolerance contract (matches Python):
 *   - skips lines that fail JSON.parse (not thrown)
 *   - skips non-object lines + lines without an "event" key (header)
 *   - status events with unknown id (out-of-order corruption) skipped
 *
 * Two-pass status resolution (matches Python read_all_items):
 *   - Pass 1 applies ALL `append` events (base records, union of both files)
 *   - Pass 2 applies ALL `status` events ordered by (ts, file-order): ts is
 *     primary so the chronologically-later flip in EITHER file wins; file
 *     order (tracked-before-outbox) is the stable tiebreaker for equal ts,
 *     preserving the single-file "later valid line wins by file order"
 *     contract. The append-first split stops an outbox append (status:triage)
 *     from clobbering a tracked status flip.
 *   - status overlay sets: status, ts, statusBy, statusReason
 *   - promotedTaskId only set when the status event carries a non-null value
 *
 * Cache (5 s soft TTL) keyed by the tracked path, keyed on BOTH the tracked
 * AND outbox mtimes — a change to either file invalidates. Forced eviction
 * via invalidateCacheForPath() (called from triage-write.ts).
 */

import {
  readFileSync,
  statSync,
} from "node:fs";

import type { TriageItem, TriageStatus } from "../types/triage.js";
import { outboxPathFor } from "./triage-paths.js";

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

function tryParseLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** mtime in ms, or null when the file is absent / unstat-able. */
function mtimeOrNull(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Tolerant per-file reader — parses one JSONL file into plain objects,
 * skipping blank + corrupt + non-object lines (mirrors Python
 * `_iter_raw_lines_at`). Returns [] when the file is missing/unreadable.
 * `line.trim()` absorbs a trailing `\r` (CRLF), so a Windows-written or
 * human-edited line round-trips unchanged.
 */
function readRawLines(p: string): Record<string, unknown>[] {
  let raw: string;
  try {
    raw = readFileSync(p, "utf-8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = tryParseLine(line);
    if (parsed === undefined) continue; // corrupt — skip
    if (!isPlainObject(parsed)) continue;
    out.push(parsed);
  }
  return out;
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
 * `status` events ordered by (ts, file-order).
 */
function resolveUnion(rawLines: Record<string, unknown>[]): TriageItem[] {
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
    resolved.set(id, item);
  }

  // Pass 2 — overlay status flips ordered by (ts, file-order). ts is primary
  // so a chronologically-later status in EITHER file wins; the enumerate
  // index is the stable tiebreaker for equal ts (tracked precedes outbox).
  const statusEvents: { idx: number; raw: Record<string, unknown> }[] = [];
  rawLines.forEach((raw, idx) => {
    if (raw.event === "status") statusEvents.push({ idx, raw });
  });
  statusEvents.sort((a, b) => {
    const ta = tsKey(a.raw);
    const tb = tsKey(b.raw);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return a.idx - b.idx;
  });
  for (const { raw } of statusEvents) {
    const id = raw.id;
    if (typeof id !== "string") continue;
    const item = resolved.get(id);
    if (!item) continue; // status for unknown id (corrupt / out-of-order) — skip
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

  // Dual-mtime cache lookup (keyed by the tracked path).
  const cached = cache.get(trackedPath);
  if (
    cached &&
    cached.trackedMtimeMs === trackedMtimeMs &&
    cached.outboxMtimeMs === outboxMtimeMs &&
    Date.now() - cached.filledAt < CACHE_TTL_MS
  ) {
    return cached.items;
  }

  // Tolerant union read: tracked lines THEN outbox lines (file order).
  const rawLines = [...readRawLines(trackedPath), ...readRawLines(outboxPath)];
  const items = resolveUnion(rawLines);

  cache.set(trackedPath, {
    trackedMtimeMs,
    outboxMtimeMs,
    filledAt: Date.now(),
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
