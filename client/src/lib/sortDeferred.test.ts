import { describe, it, expect } from "vitest";
import { sortDeferred } from "./sortDeferred";
import type { TriageItem, TriageSeverity } from "./triageApi";

const SEVERITY_RANK: Record<TriageSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function item(overrides: Partial<TriageItem> & Pick<TriageItem, "id">): TriageItem {
  return {
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
    status: "snoozed",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    amendedBy: null,
    amendedAt: null,
    ...overrides,
  };
}

describe("sortDeferred", () => {
  it("orders dated entries before undated ones", () => {
    const items = [item({ id: "trg-undated", revisitAt: null }), item({ id: "trg-dated", revisitAt: "2099-01-01" })];
    expect(sortDeferred(items, SEVERITY_RANK).map((i) => i.id)).toEqual(["trg-dated", "trg-undated"]);
  });

  it("orders dated entries by soonest date first", () => {
    const items = [
      item({ id: "trg-later", revisitAt: "2099-06-01" }),
      item({ id: "trg-sooner", revisitAt: "2099-01-01" }),
    ];
    expect(sortDeferred(items, SEVERITY_RANK).map((i) => i.id)).toEqual(["trg-sooner", "trg-later"]);
  });

  it("breaks an undated tie by severity, critical first", () => {
    const items = [
      item({ id: "trg-low", severity: "low", revisitAt: null }),
      item({ id: "trg-critical", severity: "critical", revisitAt: null }),
    ];
    expect(sortDeferred(items, SEVERITY_RANK).map((i) => i.id)).toEqual(["trg-critical", "trg-low"]);
  });

  it("breaks a final tie by id — a total order", () => {
    const items = [
      item({ id: "trg-b", revisitAt: "2099-01-01", severity: "high" }),
      item({ id: "trg-a", revisitAt: "2099-01-01", severity: "high" }),
    ];
    expect(sortDeferred(items, SEVERITY_RANK).map((i) => i.id)).toEqual(["trg-a", "trg-b"]);
  });

  it("rejects a malformed revisitAt as if undated", () => {
    const items = [
      item({ id: "trg-garbage", revisitAt: "not-a-date" }),
      item({ id: "trg-real", revisitAt: "2099-01-01" }),
    ];
    expect(sortDeferred(items, SEVERITY_RANK).map((i) => i.id)).toEqual(["trg-real", "trg-garbage"]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ id: "trg-b" }), item({ id: "trg-a" })];
    const original = [...items];
    sortDeferred(items, SEVERITY_RANK);
    expect(items).toEqual(original);
  });
});
