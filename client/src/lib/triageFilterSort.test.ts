// @covers FR-01.30
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SORT_STATE,
  activeFilterCount,
  entryKey,
  formatCount,
  getComplexity,
  matchesAttributeFilters,
  selectVisibleDeferredItems,
  selectVisibleOpenItems,
  sortEntries,
  type TriageSortState,
} from "./triageFilterSort";
import { entry, filters, item } from "../test/triageFixtures";

// @covers FR-01.30
describe("getComplexity", () => {
  it("resolves to 'unset' when the item carries no complexity field", () => {
    expect(getComplexity(item({ id: "trg-1" }))).toBe("unset");
  });
  it("classifies an unrecognized producer value as 'unset'", () => {
    const odd = { ...item({ id: "trg-1" }), suggestedComplexity: "huge" } as never;
    expect(getComplexity(odd)).toBe("unset");
  });
  it("passes a real value through", () => {
    const real = { ...item({ id: "trg-1" }), suggestedComplexity: "large" } as never;
    expect(getComplexity(real)).toBe("large");
  });
});

// @covers FR-01.30
describe("include-set filters (empty = all, ticked = only those)", () => {
  const hi = item({ id: "a", severity: "high", suggestedPriority: "P1", source: "compliance", suggestedDomain: "Quality" });
  const lo = item({ id: "b", severity: "low", suggestedPriority: "P3", source: "manual", suggestedDomain: "Product" });

  it("shows everything when nothing is ticked", () => {
    expect(matchesAttributeFilters(hi, filters())).toBe(true);
    expect(matchesAttributeFilters(lo, filters())).toBe(true);
  });
  it("shows only the ticked severity", () => {
    const f = filters({ severities: new Set(["high"]) });
    expect(matchesAttributeFilters(hi, f)).toBe(true);
    expect(matchesAttributeFilters(lo, f)).toBe(false);
  });
  it("ANDs across groups and ORs inside one group", () => {
    const f = filters({
      severities: new Set(["high", "low"]),
      sources: new Set(["manual"]),
    });
    expect(matchesAttributeFilters(hi, f)).toBe(false);
    expect(matchesAttributeFilters(lo, f)).toBe(true);
  });
  it("filters priority, domain and complexity", () => {
    expect(matchesAttributeFilters(hi, filters({ priorities: new Set(["P3"]) }))).toBe(false);
    expect(matchesAttributeFilters(lo, filters({ domains: new Set(["Product"]) }))).toBe(true);
    expect(matchesAttributeFilters(lo, filters({ complexities: new Set(["unset"]) }))).toBe(true);
    expect(matchesAttributeFilters(lo, filters({ complexities: new Set(["small"]) }))).toBe(false);
  });
  it("counts ticked values (drives the funnel dot)", () => {
    expect(activeFilterCount(filters())).toBe(0);
    expect(activeFilterCount(filters({ severities: new Set(["high", "low"]), domains: new Set(["x"]) }))).toBe(3);
  });
});

// @covers FR-01.30
describe("selectVisibleOpenItems — returned-park bypass", () => {
  it("keeps a returned park even when no ticked value matches it, and does not count it hidden", () => {
    const returned = entry("p", { id: "r", suggestedPriority: "P3", revisitDue: true });
    const plain = entry("p", { id: "x", suggestedPriority: "P3" });
    const r = selectVisibleOpenItems([returned, plain], filters({ priorities: new Set(["P0"]) }));
    expect(r.visible.map((e) => e.item.id)).toEqual(["r"]);
    expect(r.hiddenCount).toBe(1);
  });
});

// @covers FR-01.30
describe("selectVisibleDeferredItems — Parked switch and dateless exception", () => {
  const dated = entry("p", { id: "dated", status: "snoozed", revisitAt: "2027-01-01" });
  const dateless = entry("p", { id: "none", status: "snoozed", revisitAt: null });

  it("Parked off: dated hidden, dateless stays visible", () => {
    const r = selectVisibleDeferredItems([dated, dateless], filters());
    expect(r.visible.map((e) => e.item.id)).toEqual(["none"]);
    expect(r.hiddenCount).toBe(1);
  });
  it("Parked on: both visible", () => {
    const r = selectVisibleDeferredItems([dated, dateless], filters({ showParked: true }));
    expect(r.visible).toHaveLength(2);
  });
  it("a dateless park still respects the ticked values (AND, not a bypass)", () => {
    const d = entry("p", { id: "n2", status: "snoozed", revisitAt: null, suggestedPriority: "P3" });
    const r = selectVisibleDeferredItems([d], filters({ priorities: new Set(["P0"]) }));
    expect(r.visible).toHaveLength(0);
  });
  it("Parked on + ticked value filters a dated park", () => {
    const r = selectVisibleDeferredItems(
      [dated],
      filters({ showParked: true, severities: new Set(["low"]) }),
    );
    expect(r.visible).toHaveLength(0);
  });
});

// @covers FR-01.30
describe("formatCount", () => {
  it("prints N when nothing is hidden and 'N of M' otherwise", () => {
    expect(formatCount(3, 3)).toBe("3");
    expect(formatCount(2, 5)).toBe("2 of 5");
  });
});

// @covers FR-01.30
describe("sortEntries", () => {
  const crit = entry("p", { id: "c", severity: "critical", suggestedPriority: "P0", title: "b", ts: "2026-01-02T00:00:00Z" });
  const low = entry("p", { id: "l", severity: "low", suggestedPriority: "P3", title: "a", ts: "2026-01-03T00:00:00Z" });
  const med = entry("p", { id: "m", severity: "medium", suggestedPriority: "P2", title: "c", ts: "2026-01-01T00:00:00Z" });
  const all = [low, med, crit];
  const ids = (l: ReturnType<typeof sortEntries>) => l.map((e) => e.item.id);
  const s = (pk: TriageSortState["primary"]["key"], pd: "asc" | "desc"): TriageSortState => ({
    primary: { key: pk, direction: pd },
    secondary: DEFAULT_SORT_STATE.secondary,
  });

  it("default: most severe first, then newest", () => {
    expect(ids(sortEntries(all, DEFAULT_SORT_STATE))).toEqual(["c", "m", "l"]);
  });
  it("severity ascending puts the least severe first", () => {
    expect(ids(sortEntries(all, s("severity", "asc")))).toEqual(["l", "m", "c"]);
  });
  it("priority descending puts P0 first; ascending puts P3 first", () => {
    expect(ids(sortEntries(all, s("priority", "desc")))).toEqual(["c", "m", "l"]);
    expect(ids(sortEntries(all, s("priority", "asc")))).toEqual(["l", "m", "c"]);
  });
  it("modified uses the status-decision time: desc = newest first", () => {
    expect(ids(sortEntries(all, s("modified", "desc")))).toEqual(["l", "c", "m"]);
    expect(ids(sortEntries(all, s("modified", "asc")))).toEqual(["m", "c", "l"]);
  });
  it("modified sorts by ts, never originalTs", () => {
    const a = entry("p", { id: "a", ts: "2026-02-01T00:00:00Z", originalTs: "2020-01-01T00:00:00Z" });
    const b = entry("p", { id: "b", ts: "2026-01-01T00:00:00Z", originalTs: "2030-01-01T00:00:00Z" });
    expect(ids(sortEntries([b, a], s("modified", "desc")))).toEqual(["a", "b"]);
  });
  it("name sorts with a pinned root locale (spy-asserted)", () => {
    const spy = vi.spyOn(String.prototype, "localeCompare");
    sortEntries(all, s("name", "asc"));
    expect(spy.mock.calls.some((c) => c[1] === "und")).toBe(true);
    spy.mockRestore();
    expect(ids(sortEntries(all, s("name", "asc")))).toEqual(["l", "c", "m"]);
  });
  it("secondary direction is independent of the primary", () => {
    const t = entry("p", { id: "t", severity: "high", ts: "2026-01-01T00:00:00Z" });
    const u = entry("p", { id: "u", severity: "high", ts: "2026-02-01T00:00:00Z" });
    const state: TriageSortState = {
      primary: { key: "severity", direction: "desc" },
      secondary: { key: "modified", direction: "asc" },
    };
    expect(ids(sortEntries([u, t], state))).toEqual(["t", "u"]);
  });
  it("is a total order: ties break on project then id, and input is not mutated", () => {
    const x = entry("b", { id: "same" });
    const y = entry("a", { id: "same" });
    const input = [x, y];
    expect(sortEntries(input, DEFAULT_SORT_STATE).map(entryKey)).toEqual(["a:same", "b:same"]);
    expect(input.map(entryKey)).toEqual(["b:same", "a:same"]);
  });
});
