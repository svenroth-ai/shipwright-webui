// @covers FR-01.30
import { describe, expect, it } from "vitest";

import { applyProjectOrder, moveProject } from "./triageProjectOrder";
import { defaultView, parseView, serializeView } from "./triageViewStorage";

const ps = (...ids: string[]) => ids.map((id) => ({ id }));

// @covers FR-01.30
describe("applyProjectOrder", () => {
  it("keeps the natural order when nothing is saved", () => {
    expect(applyProjectOrder(ps("a", "b", "c"), []).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("follows the saved order, ignores vanished projects and puts new ones last", () => {
    expect(applyProjectOrder(ps("a", "b", "c"), ["c", "gone", "a"]).map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});

// @covers FR-01.30
describe("moveProject", () => {
  it("moves a project onto the slot of another (down and up)", () => {
    expect(moveProject(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveProject(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("is a no-op for the same id", () => {
    expect(moveProject(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });

  it("a lane whose project is not in the saved order (vanished) can still be moved", () => {
    expect(moveProject(["a", "b"], "a", "zzz")).toEqual(["b", "zzz", "a"]);
    expect(moveProject(["a", "b"], "zzz", "a")).toEqual(["zzz", "a", "b"]);
  });
});

// @covers FR-01.30
describe("project order persistence", () => {
  it("round-trips, keeping the order", () => {
    const v = { ...defaultView(), projectOrder: ["b", "a", "c"] };
    expect(parseView(serializeView(v)).projectOrder).toEqual(["b", "a", "c"]);
  });

  it("an older saved view without the field loads with an empty order; junk entries are dropped", () => {
    const old = JSON.stringify({ v: 1, groupBy: "project" });
    expect(parseView(old).projectOrder).toEqual([]);
    const junk = JSON.stringify({ v: 1, projectOrder: ["a", 3, "", "a", "b"] });
    expect(parseView(junk).projectOrder).toEqual(["a", "b"]);
  });
});
