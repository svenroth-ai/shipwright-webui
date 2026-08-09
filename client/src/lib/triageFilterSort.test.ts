import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_FILTER_STATE,
  DEFAULT_SORT_STATE,
  formatCount,
  getComplexity,
  matchesAttributeFilters,
  selectVisibleDeferredItems,
  selectVisibleOpenItems,
  sortItems,
  type TriageFilterState,
  type TriageSortState,
} from "./triageFilterSort";
import type { TriageItem } from "./triageApi";

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
    status: "triage",
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

function filters(overrides: Partial<TriageFilterState> = {}): TriageFilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

describe("getComplexity", () => {
  it("resolves to 'unset' when the item carries no complexity field (today's reality for every item)", () => {
    expect(getComplexity(item({ id: "trg-1" }))).toBe("unset");
  });

  it("reads a forward-compat suggestedComplexity field when present on the wire object", () => {
    const withComplexity = { ...item({ id: "trg-1" }), suggestedComplexity: "large" };
    expect(getComplexity(withComplexity)).toBe("large");
  });

  it("normalizes an unrecognized wire value to 'unset' rather than passing it through unfilterable", () => {
    const withBadValue = { ...item({ id: "trg-1" }), suggestedComplexity: "xl" };
    expect(getComplexity(withBadValue)).toBe("unset");
  });
});

describe("matchesAttributeFilters", () => {
  // AC1/AC3: filters are EXCLUDE sets, not include sets — a chip starts
  // active (nothing excluded), and clicking it hides that value. Rejected
  // at spec-reviewer Stage 1: an include-by-selection model has no
  // reachable interaction for AC3's "deselecting Unset hides every item"
  // (Unset already starts deselected under include semantics).
  it("matches everything when every filter dimension is empty (default state)", () => {
    expect(matchesAttributeFilters(item({ id: "trg-1", suggestedPriority: "P3" }), DEFAULT_FILTER_STATE)).toBe(true);
  });

  it("AC1: excludes an item whose priority is in the excludedPriorities set", () => {
    const f = filters({ excludedPriorities: new Set(["P3"]) });
    expect(matchesAttributeFilters(item({ id: "trg-1", suggestedPriority: "P3" }), f)).toBe(false);
    expect(matchesAttributeFilters(item({ id: "trg-2", suggestedPriority: "P1" }), f)).toBe(true);
  });

  it("AC2: excludes an item whose domain is in the excludedDomains set", () => {
    const f = filters({ excludedDomains: new Set(["security"]) });
    expect(matchesAttributeFilters(item({ id: "trg-1", suggestedDomain: "security" }), f)).toBe(false);
    expect(matchesAttributeFilters(item({ id: "trg-2", suggestedDomain: "engineering" }), f)).toBe(true);
  });

  it("AC3: excludes an item whose complexity is in the excludedComplexities set", () => {
    const f = filters({ excludedComplexities: new Set(["unset"]) });
    expect(matchesAttributeFilters(item({ id: "trg-1" }), f)).toBe(false); // resolves to "unset"
    const f2 = filters({ excludedComplexities: new Set(["small"]) });
    expect(matchesAttributeFilters(item({ id: "trg-2" }), f2)).toBe(true); // still resolves to "unset", not excluded
  });
});

describe("selectVisibleOpenItems", () => {
  it("hides items excluded by the active filters and counts them", () => {
    const items = [
      item({ id: "trg-p1", suggestedPriority: "P1" }),
      item({ id: "trg-p3", suggestedPriority: "P3" }),
    ];
    const { visible, hiddenCount } = selectVisibleOpenItems(
      items,
      filters({ excludedPriorities: new Set(["P3"]) }),
    );
    expect(visible.map((i) => i.id)).toEqual(["trg-p1"]);
    expect(hiddenCount).toBe(1);
  });

  it("AC8: a due-parked item bypasses every active filter regardless of match", () => {
    const items = [
      item({ id: "trg-due", suggestedPriority: "P3", revisitDue: true }),
      item({ id: "trg-normal", suggestedPriority: "P3" }),
    ];
    const { visible, hiddenCount } = selectVisibleOpenItems(
      items,
      filters({ excludedPriorities: new Set(["P3"]) }),
    );
    expect(visible.map((i) => i.id)).toEqual(["trg-due"]);
    // AC8: bypassed items are excluded from hiddenCount — only trg-normal was hidden.
    expect(hiddenCount).toBe(1);
  });

  it("counts nothing hidden when the default (empty) filter state is active", () => {
    const items = [item({ id: "trg-1" }), item({ id: "trg-2" })];
    const { visible, hiddenCount } = selectVisibleOpenItems(items, DEFAULT_FILTER_STATE);
    expect(visible).toHaveLength(2);
    expect(hiddenCount).toBe(0);
  });
});

describe("selectVisibleDeferredItems", () => {
  it("AC7: hides a dated, not-yet-due park when Parked is in its default (off) state", () => {
    const items = [item({ id: "trg-dated", revisitAt: "2099-01-01" })];
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, DEFAULT_FILTER_STATE);
    expect(visible).toHaveLength(0);
    expect(hiddenCount).toBe(1);
  });

  it("AC9: a dateless park stays visible even when Parked is in its default (off) state", () => {
    const items = [item({ id: "trg-dateless", revisitAt: null })];
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, DEFAULT_FILTER_STATE);
    expect(visible.map((i) => i.id)).toEqual(["trg-dateless"]);
    expect(hiddenCount).toBe(0);
  });

  it("AC9: a dateless park still respects the attribute filters like any other item", () => {
    const items = [item({ id: "trg-dateless", revisitAt: null, suggestedDomain: "security" })];
    const f = filters({ excludedDomains: new Set(["security"]) });
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, f);
    expect(visible).toHaveLength(0);
    expect(hiddenCount).toBe(1);
  });

  it("shows every parked item (subject to attribute filters) once Parked is toggled on", () => {
    const items = [
      item({ id: "trg-dated", revisitAt: "2099-01-01" }),
      item({ id: "trg-dateless", revisitAt: null }),
    ];
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, filters({ showParked: true }));
    expect(visible.map((i) => i.id).sort()).toEqual(["trg-dated", "trg-dateless"]);
    expect(hiddenCount).toBe(0);
  });

  it("mixed set: hint-worthy hiddenCount is nonzero even when a dateless item IS visible (the plan-review fix)", () => {
    const items = [
      item({ id: "trg-dateless", revisitAt: null }),
      item({ id: "trg-dated-1", revisitAt: "2099-01-01" }),
      item({ id: "trg-dated-2", revisitAt: "2099-06-01" }),
    ];
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, DEFAULT_FILTER_STATE);
    expect(visible.map((i) => i.id)).toEqual(["trg-dateless"]);
    expect(hiddenCount).toBe(2);
  });

  it("sums Parked-default suppression and attribute-filter suppression into one hiddenCount", () => {
    const items = [
      // Hidden by Parked-off default (dated, not shown at all without the toggle).
      item({ id: "trg-dated", revisitAt: "2099-01-01" }),
      // Visible via AC9 (dateless), but then hidden by the domain filter.
      item({ id: "trg-dateless-wrong-domain", revisitAt: null, suggestedDomain: "security" }),
    ];
    const f = filters({ excludedDomains: new Set(["security"]) });
    const { visible, hiddenCount } = selectVisibleDeferredItems(items, f);
    expect(visible).toHaveLength(0);
    expect(hiddenCount).toBe(2);
  });
});

describe("sortItems", () => {
  it("sorts by the primary key ascending", () => {
    const items = [item({ id: "trg-b", title: "Bravo" }), item({ id: "trg-a", title: "Alpha" })];
    const sort: TriageSortState = { primary: { key: "name", direction: "asc" }, secondary: { key: "modified", direction: "asc" } };
    expect(sortItems(items, sort).map((i) => i.id)).toEqual(["trg-a", "trg-b"]);
  });

  it("reverses independently when the primary direction is descending", () => {
    const items = [item({ id: "trg-a", title: "Alpha" }), item({ id: "trg-b", title: "Bravo" })];
    const sort: TriageSortState = { primary: { key: "name", direction: "desc" }, secondary: { key: "modified", direction: "asc" } };
    expect(sortItems(items, sort).map((i) => i.id)).toEqual(["trg-b", "trg-a"]);
  });

  it("uses the secondary key to break a primary-key tie", () => {
    const items = [
      item({ id: "trg-1", suggestedDomain: "engineering", title: "Bravo" }),
      item({ id: "trg-2", suggestedDomain: "engineering", title: "Alpha" }),
    ];
    const sort: TriageSortState = {
      primary: { key: "domain", direction: "asc" },
      secondary: { key: "name", direction: "asc" },
    };
    expect(sortItems(items, sort).map((i) => i.id)).toEqual(["trg-2", "trg-1"]);
  });

  it("AC4: reverses the secondary axis independently of the primary axis when secondary is descending", () => {
    const items = [
      item({ id: "trg-1", suggestedDomain: "engineering", title: "Bravo" }),
      item({ id: "trg-2", suggestedDomain: "engineering", title: "Alpha" }),
    ];
    const sort: TriageSortState = {
      primary: { key: "domain", direction: "asc" },
      secondary: { key: "name", direction: "desc" },
    };
    // Same primary-key tie as the test above, but secondary now DESC —
    // the tie-break order must invert (Bravo before Alpha).
    expect(sortItems(items, sort).map((i) => i.id)).toEqual(["trg-1", "trg-2"]);
  });

  it("AC10: sorts Modified by `ts` (latest status event), never `originalTs` (append time)", () => {
    const items = [
      item({ id: "trg-old-append-new-status", originalTs: "2026-01-01T00:00:00Z", ts: "2026-08-01T00:00:00Z" }),
      item({ id: "trg-new-append-old-status", originalTs: "2026-07-01T00:00:00Z", ts: "2026-02-01T00:00:00Z" }),
    ];
    const sort: TriageSortState = {
      primary: { key: "modified", direction: "desc" },
      secondary: { key: "name", direction: "asc" },
    };
    expect(sortItems(items, sort).map((i) => i.id)).toEqual([
      "trg-old-append-new-status",
      "trg-new-append-old-status",
    ]);
  });

  it("breaks a full tie by id — a total order invariant under input permutation", () => {
    const a = item({ id: "trg-a", title: "same", suggestedDomain: "same", ts: "2026-06-01T00:00:00Z" });
    const b = item({ id: "trg-b", title: "same", suggestedDomain: "same", ts: "2026-06-01T00:00:00Z" });
    const forward = sortItems([a, b], DEFAULT_SORT_STATE).map((i) => i.id);
    const reversed = sortItems([b, a], DEFAULT_SORT_STATE).map((i) => i.id);
    expect(forward).toEqual(["trg-a", "trg-b"]);
    expect(reversed).toEqual(forward);
  });

  it("compares names numerically, not lexicographically (pinned localeCompare options)", () => {
    const items = [item({ id: "trg-10", title: "item10" }), item({ id: "trg-2", title: "item2" })];
    const sort: TriageSortState = { primary: { key: "name", direction: "asc" }, secondary: { key: "modified", direction: "asc" } };
    expect(sortItems(items, sort).map((i) => i.id)).toEqual(["trg-2", "trg-10"]);
  });

  it("AC4: pins the locale itself, not just the comparison options, on both localeCompare calls (external code-review finding — sensitivity/numeric options alone still floated on the runtime's default ICU locale)", () => {
    const spy = vi.spyOn(String.prototype, "localeCompare");
    const items = [
      item({ id: "trg-a", title: "b-item", suggestedDomain: "b-domain" }),
      item({ id: "trg-b", title: "a-item", suggestedDomain: "a-domain" }),
    ];
    sortItems(items, {
      primary: { key: "name", direction: "asc" },
      secondary: { key: "domain", direction: "asc" },
    });
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call[1]).toBe("und");
    }
    spy.mockRestore();
  });

  it("does not mutate the input array", () => {
    const items = [item({ id: "trg-b", title: "Bravo" }), item({ id: "trg-a", title: "Alpha" })];
    const original = [...items];
    sortItems(items, DEFAULT_SORT_STATE);
    expect(items).toEqual(original);
  });
});

describe("formatCount", () => {
  it("renders a bare number when nothing is filtered out", () => {
    expect(formatCount(3, 3)).toBe("3");
  });

  it("renders 'visible of total' when the counts differ", () => {
    expect(formatCount(1, 4)).toBe("1 of 4");
  });
});
