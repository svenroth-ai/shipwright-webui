/*
 * triage-defer.test.ts — parked-entry lifecycle coverage for
 * iterate-2026-08-05-triage-deferred-envelope (monorepo P2.03 parity).
 *
 * Pure-function tests only — no file I/O, no cache. The exact-boundary
 * due-today case is deliberately tested ONLY here (never baked into a
 * committed fixture, which would go stale the next calendar day — see the
 * spec's "Plan review corrections" section, M3).
 */

import { describe, it, expect } from "vitest";
import {
  applyDeferOverlay,
  isDue,
  parseRevisitDate,
  sortDeferred,
  utcToday,
} from "./triage-defer.js";
import type { TriageItem } from "../types/triage.js";

function baseItem(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "trg-x",
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "t",
    detail: "d",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    ...overrides,
  };
}

describe("triage-defer: parseRevisitDate", () => {
  it("accepts an exact YYYY-MM-DD calendar date", () => {
    expect(parseRevisitDate("2026-09-01")).toBe("2026-09-01");
  });

  it.each([
    [null, "null"],
    [undefined, "undefined"],
    [42, "a number"],
    ["2026-9-1", "non-zero-padded"],
    ["2026-09-01T00:00:00Z", "an ISO timestamp, not a bare date"],
    [" 2026-09-01", "leading whitespace"],
    ["2026-09-01 ", "trailing whitespace"],
    ["2026-02-30", "an out-of-range calendar day (no Feb 30)"],
    ["2026-13-01", "an out-of-range month"],
    ["not-a-date", "garbage"],
  ])("rejects %j (%s)", (raw) => {
    expect(parseRevisitDate(raw)).toBeNull();
  });

  it("accepts a leap-day that really exists", () => {
    expect(parseRevisitDate("2024-02-29")).toBe("2024-02-29");
  });

  it("rejects a leap-day in a non-leap year", () => {
    expect(parseRevisitDate("2026-02-29")).toBeNull();
  });
});

describe("triage-defer: utcToday", () => {
  it("returns the UTC calendar day", () => {
    expect(utcToday(new Date("2026-08-05T23:59:59Z"))).toBe("2026-08-05");
    expect(utcToday(new Date("2026-08-05T00:00:00Z"))).toBe("2026-08-05");
  });
});

describe("triage-defer: isDue", () => {
  it("is due exactly ON the named day (00:00 UTC boundary)", () => {
    expect(isDue("2026-08-05", "2026-08-05")).toBe(true);
  });

  it("is NOT due the day before", () => {
    expect(isDue("2026-08-05", "2026-08-04")).toBe(false);
  });

  it("is due the day after (and every day after)", () => {
    expect(isDue("2026-08-05", "2026-08-06")).toBe(true);
  });

  it("an unreadable or missing date is never due", () => {
    expect(isDue(null, "2099-01-01")).toBe(false);
    expect(isDue("garbage", "2099-01-01")).toBe(false);
    expect(isDue(undefined, "2099-01-01")).toBe(false);
  });
});

describe("triage-defer: applyDeferOverlay", () => {
  it("resolves a due park back to status:triage, revisitDue:true, revisitAt kept", () => {
    const items = [
      baseItem({ id: "trg-due", status: "snoozed", revisitAt: "2020-01-01" }),
    ];
    const [out] = applyDeferOverlay(items, new Date("2026-08-05T12:00:00Z"));
    expect(out.status).toBe("triage");
    expect(out.revisitDue).toBe(true);
    expect(out.revisitAt).toBe("2020-01-01");
  });

  it("keeps a not-yet-due park snoozed with revisitDue:false", () => {
    const items = [
      baseItem({ id: "trg-future", status: "snoozed", revisitAt: "2099-01-01" }),
    ];
    const [out] = applyDeferOverlay(items, new Date("2026-08-05T12:00:00Z"));
    expect(out.status).toBe("snoozed");
    expect(out.revisitDue).toBe(false);
  });

  it("exact-boundary: due on the calendar day itself, not the day after (injected clock)", () => {
    const items = [
      baseItem({ id: "trg-today", status: "snoozed", revisitAt: "2026-08-05" }),
    ];
    const notYet = applyDeferOverlay(items, new Date("2026-08-04T23:59:59Z"));
    expect(notYet[0].status).toBe("snoozed");
    const dueNow = applyDeferOverlay(items, new Date("2026-08-05T00:00:01Z"));
    expect(dueNow[0].status).toBe("triage");
    expect(dueNow[0].revisitDue).toBe(true);
  });

  it("an undated park (parked-without-date) stays snoozed forever — revisitDue always false", () => {
    const items = [baseItem({ id: "trg-undated", status: "snoozed", revisitAt: null })];
    const out1 = applyDeferOverlay(items, new Date("2026-08-05T00:00:00Z"));
    expect(out1[0].status).toBe("snoozed");
    expect(out1[0].revisitDue).toBe(false);
    const farFuture = applyDeferOverlay(items, new Date("2099-01-01T00:00:00Z"));
    expect(farFuture[0].status).toBe("snoozed");
    expect(farFuture[0].revisitDue).toBe(false);
  });

  it("a non-parked item always gets revisitDue:false regardless of any stray revisitAt", () => {
    const items = [
      baseItem({ id: "trg-open", status: "triage", revisitAt: null }),
      baseItem({ id: "trg-dismissed", status: "dismissed", revisitAt: null }),
    ];
    const out = applyDeferOverlay(items, new Date("2026-08-05T00:00:00Z"));
    expect(out.every((i) => i.revisitDue === false)).toBe(true);
  });

  it("is idempotent when applied exactly once per view — re-applying to its own output is a documented non-goal, but a single pass never mutates the input array", () => {
    const items = [
      baseItem({ id: "trg-due", status: "snoozed", revisitAt: "2020-01-01" }),
    ];
    const out = applyDeferOverlay(items, new Date("2026-08-05T00:00:00Z"));
    expect(items[0].status).toBe("snoozed"); // input untouched
    expect(out).not.toBe(items); // new array
    expect(out[0]).not.toBe(items[0]); // new item objects
  });
});

describe("triage-defer: sortDeferred", () => {
  const SEVERITY_RANK: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  it("orders dated entries before undated ones", () => {
    const items = [
      baseItem({ id: "trg-undated", revisitAt: null }),
      baseItem({ id: "trg-dated", revisitAt: "2099-01-01" }),
    ];
    const sorted = sortDeferred(items, SEVERITY_RANK);
    expect(sorted.map((i) => i.id)).toEqual(["trg-dated", "trg-undated"]);
  });

  it("orders dated entries by soonest date first", () => {
    const items = [
      baseItem({ id: "trg-later", revisitAt: "2099-06-01" }),
      baseItem({ id: "trg-sooner", revisitAt: "2099-01-01" }),
    ];
    const sorted = sortDeferred(items, SEVERITY_RANK);
    expect(sorted.map((i) => i.id)).toEqual(["trg-sooner", "trg-later"]);
  });

  it("breaks a tie (both undated) by severity, critical first, unknown last", () => {
    const items = [
      baseItem({ id: "trg-unknown-sev", severity: "weird" as never, revisitAt: null }),
      baseItem({ id: "trg-low", severity: "low", revisitAt: null }),
      baseItem({ id: "trg-critical", severity: "critical", revisitAt: null }),
    ];
    const sorted = sortDeferred(items, SEVERITY_RANK);
    expect(sorted.map((i) => i.id)).toEqual(["trg-critical", "trg-low", "trg-unknown-sev"]);
  });

  it("breaks a final tie (same date, same severity) by id — a TOTAL order", () => {
    const items = [
      baseItem({ id: "trg-b", revisitAt: "2099-01-01", severity: "high" }),
      baseItem({ id: "trg-a", revisitAt: "2099-01-01", severity: "high" }),
    ];
    const sorted = sortDeferred(items, SEVERITY_RANK);
    expect(sorted.map((i) => i.id)).toEqual(["trg-a", "trg-b"]);
  });

  it("does not mutate the input array", () => {
    const items = [baseItem({ id: "trg-b" }), baseItem({ id: "trg-a" })];
    const original = [...items];
    sortDeferred(items, SEVERITY_RANK);
    expect(items).toEqual(original);
  });
});
