import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditLogEntry, AuditLogPage } from "./orgApi";
import {
  mergeAuditTimelineEntries,
  hasMoreToLoad,
  isAtWindowCeiling,
  computeLastNightWindow,
  DEFAULT_WINDOW,
  MAX_WINDOW,
} from "./auditTimelineMerge";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_AUDIT_LOG_PATH = resolve(__dirname, "..", "..", "..", "server", "src", "external", "org", "audit-log.ts");

function entry(ts: string, extra: Record<string, unknown> = {}): AuditLogEntry {
  const parsed = { ts, kind: "beat_started", lead_id: "x", parent_lead_id: null, ...extra };
  return { raw: JSON.stringify(parsed), parsed };
}

function rawEntry(raw: string): AuditLogEntry {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  return { raw, parsed };
}

function page(entries: AuditLogEntry[]): AuditLogPage {
  return { entries, total: entries.length, nextCursor: null };
}

describe("mergeAuditTimelineEntries — the interleave/no-gap/no-repeat probe", () => {
  it("merges two leads' newest-first streams into one correctly time-sorted list", () => {
    // Lead A: 10, 8, 6, 4, 2 (newest first). Lead B: 9, 7, 5, 3, 1.
    const leadA = page([
      entry("2026-09-06T10:00:00.000Z"),
      entry("2026-09-06T08:00:00.000Z"),
      entry("2026-09-06T06:00:00.000Z"),
      entry("2026-09-06T04:00:00.000Z"),
      entry("2026-09-06T02:00:00.000Z"),
    ]);
    const leadB = page([
      entry("2026-09-06T09:00:00.000Z"),
      entry("2026-09-06T07:00:00.000Z"),
      entry("2026-09-06T05:00:00.000Z"),
      entry("2026-09-06T03:00:00.000Z"),
      entry("2026-09-06T01:00:00.000Z"),
    ]);
    const merged = mergeAuditTimelineEntries({ a: leadA, b: leadB }, {}, 4);
    expect(merged.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T09:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
      "2026-09-06T07:00:00.000Z",
    ]);

    // "Page 2" = re-run with a bigger window (stateless — same fixture,
    // no cursor). Must contain page 1's rows plus exactly the next-oldest,
    // no gap, no repeat.
    const page2 = mergeAuditTimelineEntries({ a: leadA, b: leadB }, {}, 8);
    expect(page2.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T09:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
      "2026-09-06T07:00:00.000Z",
      "2026-09-06T06:00:00.000Z",
      "2026-09-06T05:00:00.000Z",
      "2026-09-06T04:00:00.000Z",
      "2026-09-06T03:00:00.000Z",
    ]);
    // No entry from page 1 is missing from page 2's prefix, and none repeats
    // within page 2 itself.
    const seen = new Set(page2.map((r) => r.entry.raw));
    expect(seen.size).toBe(page2.length);
    for (const row of merged) {
      expect(page2.some((r) => r.entry.raw === row.entry.raw)).toBe(true);
    }
  });

  it("stays correct when a lead's file GREW between rounds (concurrent daemon append)", () => {
    // Round 1: lead A has 3 entries.
    const roundOneA = page([
      entry("2026-09-06T10:00:00.000Z"),
      entry("2026-09-06T08:00:00.000Z"),
      entry("2026-09-06T06:00:00.000Z"),
    ]);
    const leadB = page([entry("2026-09-06T09:00:00.000Z"), entry("2026-09-06T07:00:00.000Z")]);
    const r1 = mergeAuditTimelineEntries({ a: roundOneA, b: leadB }, {}, DEFAULT_WINDOW);
    expect(r1.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T09:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
      "2026-09-06T07:00:00.000Z",
      "2026-09-06T06:00:00.000Z",
    ]);

    // Between rounds, the daemon appends TWO newer entries to lead A. Since
    // this design always re-fetches from `before: 0`, the "new" page just
    // has those two entries at the front — no separate fetch bookkeeping.
    const roundTwoA = page([
      entry("2026-09-06T12:00:00.000Z"),
      entry("2026-09-06T11:00:00.000Z"),
      entry("2026-09-06T10:00:00.000Z"),
      entry("2026-09-06T08:00:00.000Z"),
      entry("2026-09-06T06:00:00.000Z"),
    ]);
    const r2 = mergeAuditTimelineEntries({ a: roundTwoA, b: leadB }, {}, DEFAULT_WINDOW);
    expect(r2.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T12:00:00.000Z",
      "2026-09-06T11:00:00.000Z",
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T09:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
      "2026-09-06T07:00:00.000Z",
      "2026-09-06T06:00:00.000Z",
    ]);
    // No duplicates in round 2's output.
    const seen2 = new Set(r2.map((r) => r.entry.raw));
    expect(seen2.size).toBe(r2.length);
  });

  it("a lead with fewer entries than windowSize doesn't stall or corrupt the merge", () => {
    const leadA = page([entry("2026-09-06T10:00:00.000Z")]);
    const leadB = page([
      entry("2026-09-06T09:00:00.000Z"),
      entry("2026-09-06T08:00:00.000Z"),
      entry("2026-09-06T07:00:00.000Z"),
    ]);
    const merged = mergeAuditTimelineEntries({ a: leadA, b: leadB }, {}, 10);
    expect(merged).toHaveLength(4);
    expect(merged[0].entry.parsed?.ts).toBe("2026-09-06T10:00:00.000Z");
  });

  it("event-type filter narrows output; non-matching entries never appear (no cursor to adjust — stateless)", () => {
    const leadA = page([
      entry("2026-09-06T10:00:00.000Z", { kind: "beat_completed" }),
      entry("2026-09-06T09:00:00.000Z", { kind: "beat_started" }),
      entry("2026-09-06T08:00:00.000Z", { kind: "beat_completed" }),
    ]);
    const merged = mergeAuditTimelineEntries({ a: leadA }, { eventTypes: ["beat_completed"] }, 10);
    expect(merged.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T10:00:00.000Z",
      "2026-09-06T08:00:00.000Z",
    ]);
  });

  it("since/until time-window filter uses numeric epoch compare (both bounds inclusive)", () => {
    const leadA = page([
      entry("2026-09-06T06:00:00.001Z"),
      entry("2026-09-06T06:00:00.000Z"),
      entry("2026-09-06T05:00:00.000Z"),
      entry("2026-09-06T04:00:00.000Z"),
    ]);
    const sinceMs = Date.parse("2026-09-06T04:00:00.000Z");
    const untilMs = Date.parse("2026-09-06T06:00:00.000Z");
    const merged = mergeAuditTimelineEntries({ a: leadA }, { sinceMs, untilMs }, 10);
    // The 06:00:00.001 entry (1ms past until) is excluded; the entry AT
    // exactly 06:00:00.000 is included — external-review finding: a
    // "Last night ... -> today 06:00" preset must not silently drop an
    // entry logged at the boundary instant itself.
    expect(merged.map((r) => r.entry.parsed?.ts)).toEqual([
      "2026-09-06T06:00:00.000Z",
      "2026-09-06T05:00:00.000Z",
      "2026-09-06T04:00:00.000Z",
    ]);
  });

  it("sorts by NUMERIC epoch ms, not lexicographic string compare (mixed millisecond precision)", () => {
    // ".5" > "" lexicographically after "00" is false the other way: this
    // is the reviewer's exact counterexample — "...:00.500Z" is 500ms AFTER
    // "...:00Z" but sorts BEFORE it as a raw string ('.' < 'Z').
    const later = entry("2026-09-06T10:00:00.500Z");
    const earlier = entry("2026-09-06T10:00:00.000Z");
    const merged = mergeAuditTimelineEntries({ a: page([earlier, later]) }, {}, 10);
    // Regardless of fetch order, numeric compare must put the later one first.
    expect(merged[0].entry.parsed?.ts).toBe("2026-09-06T10:00:00.500Z");
    expect(merged[1].entry.parsed?.ts).toBe("2026-09-06T10:00:00.000Z");
  });

  it("an entry with no valid timestamp sorts after every valid-timestamp entry, and still renders", () => {
    const good = entry("2026-09-06T10:00:00.000Z");
    const malformed = rawEntry("{not json");
    const noTs = { raw: JSON.stringify({ kind: "beat_started" }), parsed: { kind: "beat_started" } };
    const merged = mergeAuditTimelineEntries({ a: page([good, malformed, noTs]) }, {}, 10);
    expect(merged).toHaveLength(3);
    expect(merged[0].entry.raw).toBe(good.raw);
    // Both timestamp-less entries still render, after the valid one.
    expect(merged.slice(1).map((r) => r.entry.raw).sort()).toEqual(
      [malformed.raw, noTs.raw].sort(),
    );
    expect(merged[1].tsMs).toBeNull();
    expect(merged[2].tsMs).toBeNull();
  });

  it("windowSize is clamped to MAX_WINDOW even if a caller passes more", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(new Date(2026, 8, 6, 10 - i).toISOString()),
    );
    const merged = mergeAuditTimelineEntries({ a: page(entries) }, {}, 999);
    expect(merged.length).toBeLessThanOrEqual(MAX_WINDOW);
    expect(merged).toHaveLength(5);
  });

  it("actually truncates at MAX_WINDOW when there is more than MAX_WINDOW to show (external-review finding — a 5-entry fixture can't detect a removed clamp)", () => {
    const entries = Array.from({ length: MAX_WINDOW + 20 }, (_, i) =>
      entry(new Date(2026, 8, 6, 0, MAX_WINDOW + 20 - i).toISOString()),
    );
    const merged = mergeAuditTimelineEntries({ a: page(entries) }, {}, 999);
    expect(merged).toHaveLength(MAX_WINDOW);
  });

  it("caps the COMBINED total across leads at windowSize, not just each lead individually (external-review finding — 2 leads x 30 sub-saturated entries can silently drop 10 rows at windowSize=50)", () => {
    const leadA = page(Array.from({ length: 30 }, (_, i) => entry(new Date(2026, 8, 6, 0, 30 - i).toISOString())));
    const leadB = page(Array.from({ length: 30 }, (_, i) => entry(new Date(2026, 8, 5, 0, 30 - i).toISOString())));
    const merged = mergeAuditTimelineEntries({ a: leadA, b: leadB }, {}, 50);
    expect(merged).toHaveLength(50);
    // hasMoreToLoad must catch this even though NEITHER lead's own page is
    // individually saturated (30 < 50) — the combined total (60) is what
    // exceeds windowSize, and that's what's actually being truncated.
    expect(hasMoreToLoad({ a: leadA, b: leadB }, {}, 50)).toBe(true);
  });
});

describe("hasMoreToLoad / isAtWindowCeiling", () => {
  it("reports more available when a lead's fetched page exactly fills the window, below the ceiling", () => {
    const full = page(Array.from({ length: 50 }, (_, i) => entry(new Date(2026, 8, 6, i).toISOString())));
    expect(hasMoreToLoad({ a: full }, {}, 50)).toBe(true);
  });

  it("reports no more when every lead's page is smaller than the window", () => {
    const small = page([entry("2026-09-06T10:00:00.000Z")]);
    expect(hasMoreToLoad({ a: small }, {}, 50)).toBe(false);
  });

  it("reports the ceiling once windowSize reaches MAX_WINDOW and a lead is still saturated", () => {
    const full = page(Array.from({ length: MAX_WINDOW }, (_, i) => entry(new Date(2026, 8, 6, i).toISOString())));
    expect(isAtWindowCeiling({ a: full }, {}, MAX_WINDOW)).toBe(true);
    expect(hasMoreToLoad({ a: full }, {}, MAX_WINDOW)).toBe(false);
  });

  it("reports the ceiling from the COMBINED total when no single lead's page individually reaches MAX_WINDOW", () => {
    const leadA = page(Array.from({ length: 150 }, (_, i) => entry(new Date(2026, 8, 6, 0, 150 - i).toISOString())));
    const leadB = page(Array.from({ length: 150 }, (_, i) => entry(new Date(2026, 8, 5, 0, 150 - i).toISOString())));
    expect(isAtWindowCeiling({ a: leadA, b: leadB }, {}, MAX_WINDOW)).toBe(true);
  });
});

describe("computeLastNightWindow", () => {
  it("returns yesterday 18:00 -> today 06:00 local when now is after today's 06:00", () => {
    const now = new Date(2026, 8, 6, 9, 30, 0); // Sep 6, 09:30 local
    const { sinceMs, untilMs } = computeLastNightWindow(now);
    expect(new Date(sinceMs)).toEqual(new Date(2026, 8, 5, 18, 0, 0, 0));
    expect(new Date(untilMs)).toEqual(new Date(2026, 8, 6, 6, 0, 0, 0));
  });

  it("does not reach into the future when now is BEFORE today's 06:00 — uses the prior completed interval", () => {
    const now = new Date(2026, 8, 6, 3, 0, 0); // Sep 6, 03:00 local — still "last night"
    const { sinceMs, untilMs } = computeLastNightWindow(now);
    expect(new Date(sinceMs)).toEqual(new Date(2026, 8, 4, 18, 0, 0, 0));
    expect(new Date(untilMs)).toEqual(new Date(2026, 8, 5, 6, 0, 0, 0));
    expect(untilMs).toBeLessThanOrEqual(now.getTime());
  });
});

describe("DEFAULT_WINDOW / MAX_WINDOW drift guard", () => {
  it("stays in sync with the server's DEFAULT_LIMIT / MAX_LIMIT (doubt-review finding)", () => {
    // Not a cross-package import (CLAUDE.md rule 7) — a plain text read of
    // the server source, same technique as org-schema-sync.test.ts. Fails
    // loudly if either side's constant changes without the other.
    const serverSource = readFileSync(SERVER_AUDIT_LOG_PATH, "utf8");
    const defaultMatch = serverSource.match(/const DEFAULT_LIMIT = (\d+);/);
    const maxMatch = serverSource.match(/const MAX_LIMIT = (\d+);/);
    if (!defaultMatch || !maxMatch) {
      throw new Error("Could not find DEFAULT_LIMIT/MAX_LIMIT in server audit-log.ts — update this guard's regex.");
    }
    expect(DEFAULT_WINDOW).toBe(Number(defaultMatch[1]));
    expect(MAX_WINDOW).toBe(Number(maxMatch[1]));
  });
});
