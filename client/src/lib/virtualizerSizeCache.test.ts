/*
 * Tests for the virtualizer measurement cache (ADR-066 candidate).
 *
 * These tests are jsdom-friendly — visual flicker isn't testable without
 * a real browser (per conventions.md "browser-coordinated layout
 * heuristics" learning), but the cache module is pure and can be fully
 * unit-tested.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORAGE_KEY_PREFIX,
  loadSizeCache,
  persistSizeCache,
  pruneSizeCache,
  type PersistedSizeCacheV1,
} from "./virtualizerSizeCache";

const SESSION = "ae1fa969-3e00-4a40-afd1-385f53d5c490";

describe("virtualizerSizeCache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("loadSizeCache", () => {
    it("returns empty Map when no entry exists", () => {
      const cache = loadSizeCache(SESSION);
      expect(cache.size).toBe(0);
    });

    it("returns empty Map when sessionUuid is empty / nullish", () => {
      expect(loadSizeCache("").size).toBe(0);
      // @ts-expect-error testing runtime resilience
      expect(loadSizeCache(null).size).toBe(0);
      // @ts-expect-error testing runtime resilience
      expect(loadSizeCache(undefined).size).toBe(0);
    });

    it("rehydrates a v1 cache by key/size pairs", () => {
      const payload: PersistedSizeCacheV1 = {
        schemaVersion: 1,
        savedAt: "2026-05-02T20:00:00.000Z",
        entries: {
          "uuid-a": 53.6,
          "uuid-b": 914,
          "uuid-c": 70,
        },
      };
      window.localStorage.setItem(STORAGE_KEY_PREFIX + SESSION, JSON.stringify(payload));

      const cache = loadSizeCache(SESSION);
      expect(cache.size).toBe(3);
      expect(cache.get("uuid-a")).toBe(53.6);
      expect(cache.get("uuid-b")).toBe(914);
      expect(cache.get("uuid-c")).toBe(70);
    });

    it("returns empty Map when schemaVersion is missing or future", () => {
      // missing
      window.localStorage.setItem(
        STORAGE_KEY_PREFIX + SESSION,
        JSON.stringify({ savedAt: "2026-05-02", entries: { a: 50 } }),
      );
      expect(loadSizeCache(SESSION).size).toBe(0);

      // future version (not yet implemented)
      window.localStorage.setItem(
        STORAGE_KEY_PREFIX + SESSION,
        JSON.stringify({ schemaVersion: 99, entries: { a: 50 } }),
      );
      expect(loadSizeCache(SESSION).size).toBe(0);
    });

    it("returns empty Map when JSON is malformed", () => {
      window.localStorage.setItem(STORAGE_KEY_PREFIX + SESSION, "not-json{{{");
      expect(loadSizeCache(SESSION).size).toBe(0);
    });

    it("ignores entries with non-finite or non-positive size values", () => {
      window.localStorage.setItem(
        STORAGE_KEY_PREFIX + SESSION,
        JSON.stringify({
          schemaVersion: 1,
          entries: {
            valid: 80,
            zero: 0,
            negative: -10,
            nan: Number.NaN,
            tooBig: Number.POSITIVE_INFINITY,
            string: "100",
          },
        }),
      );
      const cache = loadSizeCache(SESSION);
      expect(cache.size).toBe(1);
      expect(cache.get("valid")).toBe(80);
    });

    it("survives a localStorage that throws on getItem (privacy mode)", () => {
      const original = window.localStorage.getItem;
      window.localStorage.getItem = () => {
        throw new Error("SecurityError: privacy mode");
      };
      try {
        expect(loadSizeCache(SESSION).size).toBe(0);
      } finally {
        window.localStorage.getItem = original;
      }
    });
  });

  describe("persistSizeCache", () => {
    it("writes a v1 payload with sorted-by-recency entries", () => {
      const cache = new Map<string, number>([
        ["a", 80],
        ["b", 120],
      ]);
      persistSizeCache(SESSION, cache);
      const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + SESSION);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as PersistedSizeCacheV1;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.entries).toEqual({ a: 80, b: 120 });
      expect(parsed.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("no-ops on empty Map (avoids writing empty payloads)", () => {
      persistSizeCache(SESSION, new Map());
      expect(window.localStorage.getItem(STORAGE_KEY_PREFIX + SESSION)).toBeNull();
    });

    it("no-ops when sessionUuid is empty", () => {
      const cache = new Map<string, number>([["a", 80]]);
      persistSizeCache("", cache);
      // No key written for any prefix variation.
      expect(window.localStorage.length).toBe(0);
    });

    it("caps entries at MAX_ENTRIES (drops oldest, keeps most recent)", () => {
      const cache = new Map<string, number>();
      // Insert > 1000 entries; insertion order is the recency proxy.
      for (let i = 0; i < 1500; i += 1) cache.set(`k-${i}`, 50 + i);
      persistSizeCache(SESSION, cache);

      const parsed = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY_PREFIX + SESSION)!,
      ) as PersistedSizeCacheV1;
      expect(Object.keys(parsed.entries).length).toBe(1000);
      // The 500 oldest were dropped; we kept k-500..k-1499 (the latest 1000).
      expect(parsed.entries["k-500"]).toBe(550);
      expect(parsed.entries["k-1499"]).toBe(1549);
      expect(parsed.entries["k-0"]).toBeUndefined();
    });

    it("survives a localStorage that throws on setItem (quota exceeded)", () => {
      const original = window.localStorage.setItem;
      window.localStorage.setItem = () => {
        throw new Error("QuotaExceededError");
      };
      try {
        // Should not throw to caller.
        expect(() =>
          persistSizeCache(SESSION, new Map([["a", 80]])),
        ).not.toThrow();
      } finally {
        window.localStorage.setItem = original;
      }
    });
  });

  describe("pruneSizeCache", () => {
    it("returns a new Map containing only entries whose key is in the activeKeys set", () => {
      const cache = new Map<string, number>([
        ["uuid-a", 50],
        ["uuid-b", 100],
        ["uuid-c", 80],
      ]);
      const active = new Set(["uuid-a", "uuid-c"]);
      const pruned = pruneSizeCache(cache, active);
      expect(pruned.size).toBe(2);
      expect(pruned.get("uuid-a")).toBe(50);
      expect(pruned.get("uuid-c")).toBe(80);
      expect(pruned.has("uuid-b")).toBe(false);
    });

    it("does not mutate the input cache", () => {
      const cache = new Map<string, number>([
        ["a", 50],
        ["b", 100],
      ]);
      pruneSizeCache(cache, new Set(["a"]));
      expect(cache.size).toBe(2);
    });

    it("returns an empty Map when no keys are active", () => {
      const cache = new Map<string, number>([["a", 50]]);
      const pruned = pruneSizeCache(cache, new Set());
      expect(pruned.size).toBe(0);
    });
  });

  describe("round-trip", () => {
    it("a load-after-persist returns the same Map", () => {
      const original = new Map<string, number>([
        ["uuid-a", 53.6],
        ["uuid-b", 914.375],
        ["uuid-c", 70.875],
      ]);
      persistSizeCache(SESSION, original);

      const reloaded = loadSizeCache(SESSION);
      expect(reloaded.size).toBe(original.size);
      for (const [k, v] of original) {
        expect(reloaded.get(k)).toBe(v);
      }
    });

    it("two sessions persist independently and don't bleed into each other", () => {
      const session1 = "11111111-1111-1111-1111-111111111111";
      const session2 = "22222222-2222-2222-2222-222222222222";

      persistSizeCache(session1, new Map([["a", 80]]));
      persistSizeCache(session2, new Map([["a", 200]]));

      expect(loadSizeCache(session1).get("a")).toBe(80);
      expect(loadSizeCache(session2).get("a")).toBe(200);
    });
  });
});
