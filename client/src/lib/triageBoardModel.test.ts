// @covers FR-01.30
import { describe, expect, it } from "vitest";
import { buildBoardModel, type BoardInput } from "./triageBoardModel";
import { DEFAULT_SORT_STATE } from "./triageFilterSort";
import { entry, filters } from "../test/triageFixtures";

const projects = [
  { id: "p1", name: "alpha" },
  { id: "p2", name: "beta" },
];

function input(over: Partial<BoardInput>): BoardInput {
  return {
    entries: [],
    filters: filters(),
    sort: DEFAULT_SORT_STATE,
    groupBy: "none",
    search: "",
    tile: null,
    projects,
    ...over,
  };
}

const a = entry("p1", { id: "a", severity: "critical", title: "Disk full", detail: "node 3" });
const b = entry("p2", { id: "b", severity: "low", title: "Typo", detail: "readme" });
const parkedDated = entry("p1", { id: "pd", status: "snoozed", revisitAt: "2027-02-01" });
const parkedNone = entry("p2", { id: "pn", status: "snoozed", revisitAt: null });
const all = [a, b, parkedDated, parkedNone];

describe("buildBoardModel", () => {
  it("splits open and parked, sorts most severe first", () => {
    const m = buildBoardModel(input({ entries: all }));
    expect(m.openAll).toHaveLength(2);
    expect(m.parkedAll).toHaveLength(2);
    expect(m.visibleOpen.map((e) => e.item.id)).toEqual(["a", "b"]);
  });

  it("Parked off: dateless park visible, dated hidden and counted", () => {
    const m = buildBoardModel(input({ entries: all }));
    expect(m.visibleParked.map((e) => e.item.id)).toEqual(["pn"]);
    expect(m.hiddenParked).toBe(1);
    const on = buildBoardModel(input({ entries: all, filters: filters({ showParked: true }) }));
    expect(on.visibleParked.map((e) => e.item.id)).toEqual(["pd", "pn"]);
  });

  it("ticked filter narrows the open list and counts what it hid", () => {
    const m = buildBoardModel(input({ entries: all, filters: filters({ severities: new Set(["low"]) }) }));
    expect(m.visibleOpen.map((e) => e.item.id)).toEqual(["b"]);
    expect(m.hiddenByFilters).toBe(1);
  });

  it("search matches title, detail and id, case-insensitively", () => {
    expect(buildBoardModel(input({ entries: all, search: "DISK" })).visibleOpen.map((e) => e.item.id)).toEqual(["a"]);
    expect(buildBoardModel(input({ entries: all, search: "readme" })).visibleOpen.map((e) => e.item.id)).toEqual(["b"]);
    expect(buildBoardModel(input({ entries: all, search: "b" })).visibleOpen.length).toBeGreaterThan(0);
    expect(buildBoardModel(input({ entries: all, search: "zzz" })).visibleOpen).toEqual([]);
  });

  it("the Critical + High tile narrows to those severities; attention counts them", () => {
    const m = buildBoardModel(input({ entries: all, tile: "attn" }));
    expect(m.visibleOpen.map((e) => e.item.id)).toEqual(["a"]);
    expect(m.attention).toBe(1);
  });

  it("groups the visible list", () => {
    const m = buildBoardModel(input({ entries: all, groupBy: "project" }));
    expect(m.groups.map((g) => g.label)).toEqual(["alpha", "beta"]);
  });

  it("facet counts cover all open entries regardless of filters", () => {
    const m = buildBoardModel(input({ entries: all, filters: filters({ severities: new Set(["low"]) }) }));
    expect(m.facets.severities).toEqual({ critical: 1, low: 1 });
  });

  it("the same triage id in two projects stays two distinct rows", () => {
    const x = entry("p1", { id: "same", title: "one" });
    const y = entry("p2", { id: "same", title: "two" });
    const m = buildBoardModel(input({ entries: [x, y] }));
    expect(m.visibleOpen.map((e) => `${e.projectId}:${e.item.id}`)).toEqual(["p1:same", "p2:same"]);
  });

  it("a returned park also bypasses the Critical + High tile", () => {
    const r = entry("p1", { id: "r", severity: "low", revisitDue: true });
    const m = buildBoardModel(input({ entries: [r, a, b], tile: "attn" }));
    expect(m.visibleOpen.map((e) => e.item.id).sort()).toEqual(["a", "r"]);
  });

  it("facet counts survive keys that collide with Object.prototype", () => {
    const x = entry("p1", { id: "x", suggestedDomain: "constructor" });
    const m = buildBoardModel(input({ entries: [x] }));
    expect(m.facets.domains["constructor"]).toBe(1);
  });

  it("a returned park shows even when no ticked value matches it and is not counted hidden", () => {
    const r = entry("p1", { id: "r", suggestedPriority: "P3", revisitDue: true });
    const m = buildBoardModel(input({ entries: [r, a], filters: filters({ priorities: new Set(["P0"]) }) }));
    expect(m.visibleOpen.map((e) => e.item.id)).toContain("r");
    expect(m.hiddenByFilters).toBe(1);
  });
});
