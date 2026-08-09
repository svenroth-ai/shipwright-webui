import { describe, expect, it } from "vitest";

import {
  AMENDED_AT_FIELD,
  AMENDED_BY_FIELD,
  applyAmend,
  suggestPriorityFromSeverity,
  tryApplyAmend,
  validateAmendEvent,
} from "./triage-amend.js";

function baseItem(): Record<string, unknown> {
  return {
    id: "trg-aaaa1111",
    title: "original title",
    detail: "original detail",
    severity: "low",
    kind: "bug",
    suggestedPriority: "P3",
    ts: "2026-08-01T00:00:00Z",
    [AMENDED_BY_FIELD]: null,
    [AMENDED_AT_FIELD]: null,
  };
}

describe("suggestPriorityFromSeverity", () => {
  it("maps every severity to its priority", () => {
    expect(suggestPriorityFromSeverity("critical")).toBe("P0");
    expect(suggestPriorityFromSeverity("high")).toBe("P1");
    expect(suggestPriorityFromSeverity("medium")).toBe("P2");
    expect(suggestPriorityFromSeverity("low")).toBe("P3");
    expect(suggestPriorityFromSeverity("info")).toBe("P3");
  });
});

describe("validateAmendEvent", () => {
  it("accepts an event with no amendable fields present (nothing to check)", () => {
    expect(validateAmendEvent({ event: "amend", id: "x", ts: "t", by: "cli" })).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(validateAmendEvent({ title: "   " })).toBe(false);
  });

  it("rejects a non-string title", () => {
    expect(validateAmendEvent({ title: 42 })).toBe(false);
  });

  it("rejects a non-string detail", () => {
    expect(validateAmendEvent({ detail: 42 })).toBe(false);
  });

  it("rejects an unknown severity", () => {
    expect(validateAmendEvent({ severity: "urgent" })).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(validateAmendEvent({ kind: "typo" })).toBe(false);
  });

  it("accepts a well-formed multi-field amend", () => {
    expect(
      validateAmendEvent({ title: "new", detail: "new detail", severity: "high", kind: "bug" }),
    ).toBe(true);
  });
});

describe("applyAmend", () => {
  it("overlays only present fields, leaving absent fields untouched", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: "2026-08-02T00:00:00Z", by: "sven", title: "corrected title" });
    expect(item.title).toBe("corrected title");
    expect(item.detail).toBe("original detail"); // untouched
    expect(item.severity).toBe("low"); // untouched
  });

  it("recomputes suggestedPriority on a severity amend", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: "t", by: "sven", severity: "critical" });
    expect(item.severity).toBe("critical");
    expect(item.suggestedPriority).toBe("P0");
  });

  it("changes only kind on a kind amend (no derived field)", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: "t", by: "sven", kind: "feature" });
    expect(item.kind).toBe("feature");
  });

  it("never overlays item.ts (stays the last STATUS decision time)", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: "2099-01-01T00:00:00Z", by: "sven", title: "x" });
    expect(item.ts).toBe("2026-08-01T00:00:00Z");
  });

  it("sets amendedBy/amendedAt from the event", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: "2026-08-02T00:00:00Z", by: "sven", title: "x" });
    expect(item[AMENDED_BY_FIELD]).toBe("sven");
    expect(item[AMENDED_AT_FIELD]).toBe("2026-08-02T00:00:00Z");
  });

  it("coerces a non-string by/ts to null (forged/hand-edited line guard)", () => {
    const item = baseItem();
    applyAmend(item, { id: "trg-aaaa1111", ts: 12345, by: null, title: "x" });
    expect(item[AMENDED_BY_FIELD]).toBeNull();
    expect(item[AMENDED_AT_FIELD]).toBeNull();
  });
});

describe("tryApplyAmend", () => {
  it("applies a valid amend", () => {
    const item = baseItem();
    tryApplyAmend(item, { id: "trg-aaaa1111", ts: "t", by: "sven", title: "valid" });
    expect(item.title).toBe("valid");
  });

  it("skips an invalid amend WHOLE — no partial application", () => {
    const item = baseItem();
    tryApplyAmend(item, {
      id: "trg-aaaa1111",
      ts: "t",
      by: "sven",
      title: "would-be-applied",
      severity: "not-a-real-severity",
    });
    expect(item.title).toBe("original title");
    expect(item[AMENDED_BY_FIELD]).toBeNull();
  });
});
