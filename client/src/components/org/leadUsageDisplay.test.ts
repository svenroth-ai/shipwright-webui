import { describe, it, expect } from "vitest";

import { usageLabel, usageNoteText, usageValueText } from "./leadUsageDisplay";
import type { UsageResponse } from "../../lib/orgApi";

const MEASURED: UsageResponse = {
  leadId: "acme-lead",
  measured: true,
  costUsd: 5,
  runCount: 2,
  windowDays: 7,
  asOf: "2026-08-01T00:00:00Z",
};

describe("usageLabel", () => {
  it("never contains the word 'budget'", () => {
    expect(usageLabel({ leadId: "x", measured: false })).not.toMatch(/budget/i);
    expect(usageLabel(MEASURED)).not.toMatch(/budget/i);
  });

  it("names it consumed and carries the currency", () => {
    expect(usageLabel(MEASURED)).toBe("7-day USD consumed");
    expect(usageLabel({ leadId: "x", measured: false })).toBe("USD consumed");
  });
});

describe("usageValueText", () => {
  it("marks a partial window distinctly from a complete one", () => {
    expect(usageValueText(MEASURED)).toBe("$5.00");
    expect(usageValueText({ ...MEASURED, anyNotMeasured: true })).toBe("$5.00 (partial)");
  });

  it("renders a zero cost as a real value, not 'not measured'", () => {
    expect(usageValueText({ ...MEASURED, costUsd: 0 })).toBe("$0.00");
  });
});

describe("usageNoteText", () => {
  it("returns null when there is no data at all", () => {
    expect(usageNoteText({ leadId: "x", measured: false })).toBeNull();
  });

  it("names the subagent-spend gap without a number attached to it", () => {
    expect(usageNoteText(MEASURED)).toBe("Excludes subagent spend");
  });

  it("uses singular 'call' for exactly one unpriced call", () => {
    expect(usageNoteText({ ...MEASURED, unpricedCallsTotal: 1 })).toBe(
      "Excludes subagent spend · 1 unpriced call",
    );
  });

  it("uses plural 'calls' for more than one", () => {
    expect(usageNoteText({ ...MEASURED, unpricedCallsTotal: 3 })).toBe(
      "Excludes subagent spend · 3 unpriced calls",
    );
  });

  it("omits the unpriced-calls clause entirely when it's 0 — a 0 is not noise", () => {
    expect(usageNoteText({ ...MEASURED, unpricedCallsTotal: 0 })).toBe("Excludes subagent spend");
  });

  it("prefixes 'Partial window' when anyNotMeasured is true", () => {
    expect(usageNoteText({ ...MEASURED, anyNotMeasured: true })).toBe(
      "Partial window — excludes subagent spend",
    );
  });
});
