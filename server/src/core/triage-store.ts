/*
 * triage-store.ts — TS port of `triage.read_all_items` from
 * `shared/scripts/triage.py`. Pure read path; status flips go through
 * `triage-write.ts`.
 *
 * Tolerance contract (matches Python):
 *   - skips lines that fail JSON.parse (warned to stderr, not thrown)
 *   - skips non-object lines + lines without an "event" key (header)
 *   - status events with unknown id (out-of-order corruption) skipped
 *
 * Status resolution:
 *   - file order, last status wins
 *   - status overlay sets: status, ts, statusBy, statusReason
 *   - promotedTaskId only set when the status event carries a non-null value
 *
 * mtime-keyed cache (5 s soft TTL) — invalidated by appendStatusEvent
 * via invalidateCacheForPath() (called from triage-write.ts).
 */

import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";

import type { TriageItem, TriageStatus } from "../types/triage.js";

const STATUSES: ReadonlySet<TriageStatus> = new Set([
  "triage",
  "promoted",
  "dismissed",
  "snoozed",
]);

interface CacheEntry {
  mtimeMs: number;
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

/**
 * Read and resolve every triage item for a given JSONL path.
 * Returns [] when the file is missing or contains only the header.
 */
export function readAllItems(jsonlPath: string): TriageItem[] {
  if (!existsSync(jsonlPath)) return [];

  // mtime-keyed cache lookup
  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(jsonlPath).mtimeMs;
  } catch {
    // stat failures fall through to uncached read
  }
  if (mtimeMs !== null) {
    const cached = cache.get(jsonlPath);
    if (
      cached &&
      cached.mtimeMs === mtimeMs &&
      Date.now() - cached.filledAt < CACHE_TTL_MS
    ) {
      return cached.items;
    }
  }

  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf-8");
  } catch {
    return [];
  }

  const resolved = new Map<string, TriageItem>();
  const lines = raw.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = tryParseLine(line);
    if (parsed === undefined) continue; // corrupt — skip
    if (!isPlainObject(parsed)) continue;
    const event = parsed.event;
    if (event === "append") {
      const id = parsed.id;
      if (typeof id !== "string") continue;
      // Strip "event" key, mirror Python's dict comprehension
      const item: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k === "event") continue;
        item[k] = v;
      }
      item.statusBy = null;
      item.statusReason = null;
      item.promotedTaskId = null;
      resolved.set(id, item as unknown as TriageItem);
    } else if (event === "status") {
      const id = parsed.id;
      if (typeof id !== "string" || !resolved.has(id)) continue;
      const item = resolved.get(id)!;
      const newStatus = parsed.newStatus;
      if (typeof newStatus === "string" && STATUSES.has(newStatus as TriageStatus)) {
        item.status = newStatus as TriageStatus;
      }
      const ts = parsed.ts;
      if (typeof ts === "string") {
        item.ts = ts;
      }
      // statusBy + statusReason replace previous overlay verbatim — Python
      // assigns raw.get("by") and raw.get("reason") with no presence check.
      item.statusBy = (parsed.by as string | null | undefined) ?? null;
      item.statusReason = (parsed.reason as string | null | undefined) ?? null;
      const promoted = parsed.promotedTaskId;
      // Python guard: `if raw.get("promotedTaskId") is not None`. Means
      // null/undefined keep the prior value; only an explicit non-null
      // overrides. We mirror that exactly.
      if (promoted !== undefined && promoted !== null) {
        item.promotedTaskId =
          typeof promoted === "string" ? promoted : String(promoted);
      }
    }
    // header / unknown events ignored
  }

  const items = Array.from(resolved.values());
  if (mtimeMs !== null) {
    cache.set(jsonlPath, { mtimeMs, filledAt: Date.now(), items });
  }
  return items;
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
