// @covers FR-01.30
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRIAGE_VIEW_STORAGE_KEY,
  defaultView,
  loadView,
  parseView,
  saveView,
  serializeView,
} from "./triageViewStorage";
import { DEFAULT_SORT_STATE } from "./triageFilterSort";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// @covers FR-01.30
describe("saved Triage view", () => {
  it("round-trips filters, sort, grouping and collapsed groups", () => {
    const view = {
      filters: {
        severities: new Set(["high"] as const),
        sources: new Set(["compliance"]),
        priorities: new Set(["P1"] as const),
        domains: new Set(["Quality"]),
        complexities: new Set(["unset"] as const),
        showParked: true,
      },
      sort: {
        primary: { key: "priority", direction: "asc" },
        secondary: { key: "name", direction: "desc" },
      },
      groupBy: "severity",
      collapsed: { groupBy: "severity", keys: ["severity:low"] },
      projectOrder: ["p2", "p1"],
    } as never;
    expect(parseView(serializeView(view))).toEqual(view);
  });

  it("falls back to defaults for null, garbage, wrong version and non-objects", () => {
    const d = defaultView();
    expect(parseView(null)).toEqual(d);
    expect(parseView("{not json")).toEqual(d);
    expect(parseView("[]")).toEqual(d);
    expect(parseView('{"v":2,"groupBy":"severity"}')).toEqual(d);
  });

  it("ignores the legacy exclude-set shape instead of misreading it", () => {
    const legacy = JSON.stringify({ v: 1, filters: { excludedPriorities: ["P0"], showParked: false } });
    const v = parseView(legacy);
    expect(v.filters.priorities.size).toBe(0);
  });

  it("drops unknown values inside a valid payload (never 'show nothing')", () => {
    const raw = JSON.stringify({
      v: 1,
      filters: { severities: ["high", "bogus"], priorities: ["P9"], complexities: ["huge", "small"] },
    });
    const v = parseView(raw);
    expect([...v.filters.severities]).toEqual(["high"]);
    expect(v.filters.priorities.size).toBe(0);
    expect([...v.filters.complexities]).toEqual(["small"]);
  });

  it("validates every field on its own", () => {
    const raw = JSON.stringify({
      v: 1,
      sort: { primary: { key: "domain", direction: "sideways" }, secondary: "nope" },
      groupBy: "weekday",
    });
    const v = parseView(raw);
    expect(v.sort.primary).toEqual({ key: DEFAULT_SORT_STATE.primary.key, direction: DEFAULT_SORT_STATE.primary.direction });
    expect(v.sort.secondary).toEqual(DEFAULT_SORT_STATE.secondary);
    expect(v.groupBy).toBe("project");
  });

  it("resets collapsed groups when they belong to a different grouping", () => {
    const raw = JSON.stringify({
      v: 1,
      groupBy: "severity",
      collapsed: { groupBy: "project", keys: ["project:p1"] },
    });
    expect(parseView(raw).collapsed).toEqual({ groupBy: "severity", keys: [] });
  });

  it("bounds string lists and drops non-strings", () => {
    const many = Array.from({ length: 200 }, (_, i) => `d${i}`);
    const raw = JSON.stringify({ v: 1, filters: { domains: [...many, 5, null, "x".repeat(500)] } });
    expect(parseView(raw).filters.domains.size).toBe(50);
  });

  it("loadView/saveView use the versioned key and survive a throwing storage", () => {
    saveView(defaultView());
    expect(window.localStorage.getItem(TRIAGE_VIEW_STORAGE_KEY)).toContain('"v":1');
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(loadView()).toEqual(defaultView());
    expect(() => saveView(defaultView())).not.toThrow();
  });
});
