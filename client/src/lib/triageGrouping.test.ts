// @covers FR-01.30
import { describe, it, expect } from "vitest";
import { groupEntries } from "./triageGrouping";
import { entry } from "../test/triageFixtures";

const projects = [
  { id: "p1", name: "alpha", color: "red" },
  { id: "p2", name: "beta" },
];
const label = (s: string) => (s === "req3" ? "Campaign" : s);

// @covers FR-01.30
describe("groupEntries", () => {
  const a = entry("p2", { id: "a", severity: "low", source: "manual", suggestedPriority: "P3" });
  const b = entry("p1", { id: "b", severity: "critical", source: "req3", suggestedPriority: "P0" });
  const c = entry("p1", { id: "c", severity: "critical", source: "manual", suggestedPriority: "P0" });
  const all = [a, b, c];

  it("none: one unlabeled group in input order; empty input -> no groups", () => {
    const g = groupEntries(all, "none", projects, label);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("");
    expect(g[0].entries.map((e) => e.item.id)).toEqual(["a", "b", "c"]);
    expect(groupEntries([], "none", projects, label)).toEqual([]);
  });
  it("project: follows the project order, carries name and colour, omits empty groups", () => {
    const g = groupEntries(all, "project", projects, label);
    expect(g.map((x) => x.label)).toEqual(["alpha", "beta"]);
    expect(g[0].color).toBe("red");
    expect(g[0].entries.map((e) => e.item.id)).toEqual(["b", "c"]);
    expect(groupEntries([a], "project", projects, label).map((x) => x.label)).toEqual(["beta"]);
  });
  it("severity: most severe first; priority: P0 first", () => {
    expect(groupEntries(all, "severity", projects, label).map((x) => x.label)).toEqual(["Critical", "Low"]);
    expect(groupEntries(all, "priority", projects, label).map((x) => x.label)).toEqual(["P0", "P3"]);
  });
  it("source: alphabetical by display label", () => {
    expect(groupEntries(all, "source", projects, label).map((x) => x.label)).toEqual(["Campaign", "manual"]);
  });
  it("keys are <groupBy>:<value> and stable", () => {
    expect(groupEntries(all, "severity", projects, label).map((x) => x.key)).toEqual([
      "severity:critical",
      "severity:low",
    ]);
  });
  it("never drops an entry whose project is not in the project list", () => {
    const orphan = entry("gone", { id: "o" });
    const g = groupEntries([orphan], "project", projects, label);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("gone");
  });
});
