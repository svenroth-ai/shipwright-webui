/*
 * Persistent virtualizer measurement cache.
 *
 * Why this exists (Phase 2 measurement summary, see
 * .shipwright/planning/iterate/2026-05-02-virtualized-slow-scroll-investigate.md):
 *   On long virtualized BubbleTranscript transcripts, slow scroll-up
 *   produces a visible content cascade because rows mount with the
 *   FALLBACK_ROW_PX = 96 reservation but their actual measured height is
 *   commonly 100–1700 px. TanStack Virtual caches measurements across
 *   re-renders (ADR-062 `getItemKey` keeps the cache stable), but does
 *   not persist across page reloads. Every reload of the same task
 *   produces a fresh empty cache → cascade fires every visit.
 *
 *   This module persists the (per-row) measurement Map to localStorage,
 *   keyed by sessionUuid, so subsequent page reloads of the same task
 *   rehydrate accurate sizes via TanStack Virtual's
 *   `initialMeasurementsCache` option. The cascade fires at most once
 *   on first-ever visit; subsequent visits start with correct sizes.
 *
 * NOT touched: ADR-062 virtualizer config, ADR-065 filterEventsForRender,
 * `overflow-anchor` (ADR-063 [REVERTED]), useTaskTranscript polling
 * cascade (ADR-064 [REVERTED]). All hard constraints respected.
 */

export const STORAGE_KEY_PREFIX = "webui.virtualizerCache.";
export const SCHEMA_VERSION = 1;
export const MAX_ENTRIES = 1000;

export interface PersistedSizeCacheV1 {
  schemaVersion: 1;
  savedAt?: string;
  entries: Record<string, number>;
}

function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or privacy mode — drop silently. This is a perf
    // optimization, not load-bearing storage. The next visit just falls
    // back to the FALLBACK_ROW_PX estimate path.
  }
}

function isValidSize(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Reads the persisted measurement Map for a session. Returns an empty
 * Map on any error (missing entry, malformed JSON, schema mismatch,
 * privacy-mode storage). Never throws.
 */
export function loadSizeCache(sessionUuid: string): Map<string, number> {
  const empty = new Map<string, number>();
  if (!sessionUuid || typeof sessionUuid !== "string") return empty;

  const raw = safeGetItem(STORAGE_KEY_PREFIX + sessionUuid);
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;

  const obj = parsed as Partial<PersistedSizeCacheV1>;
  if (obj.schemaVersion !== SCHEMA_VERSION) return empty;
  if (!obj.entries || typeof obj.entries !== "object") return empty;

  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(obj.entries)) {
    if (typeof k !== "string" || k.length === 0) continue;
    if (!isValidSize(v)) continue;
    out.set(k, v);
  }
  return out;
}

/**
 * Writes the measurement Map for a session. No-ops on empty Map or
 * empty/missing sessionUuid. Caps at MAX_ENTRIES, dropping the
 * insertion-oldest entries (Map iteration order is insertion order).
 * Never throws.
 */
export function persistSizeCache(
  sessionUuid: string,
  cache: Map<string, number>,
): void {
  if (!sessionUuid || typeof sessionUuid !== "string") return;
  if (cache.size === 0) return;

  const entries: Record<string, number> = {};
  let toDrop = Math.max(0, cache.size - MAX_ENTRIES);
  let count = 0;
  for (const [k, v] of cache) {
    if (toDrop > 0) {
      toDrop -= 1;
      continue;
    }
    if (!isValidSize(v)) continue;
    entries[k] = v;
    count += 1;
  }
  if (count === 0) return;

  const payload: PersistedSizeCacheV1 = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    entries,
  };
  safeSetItem(STORAGE_KEY_PREFIX + sessionUuid, JSON.stringify(payload));
}

/**
 * Returns a new Map containing only entries whose key is in `activeKeys`.
 * Useful before persist when the events list has shrunk and we don't
 * want to persist measurements for keys that no longer exist (e.g. the
 * user's "Load older" expansion was reverted, or session rotation).
 */
export function pruneSizeCache(
  cache: Map<string, number>,
  activeKeys: Set<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of cache) {
    if (activeKeys.has(k)) out.set(k, v);
  }
  return out;
}
