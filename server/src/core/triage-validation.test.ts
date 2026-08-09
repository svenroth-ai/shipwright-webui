import { describe, it, expect } from "vitest";
import { parseAmendBody } from "./triage-validation.js";

describe("parseAmendBody", () => {
  it("accepts a title-only delta", () => {
    const result = parseAmendBody({ triageId: "trg-aaaa1111", title: "New title" });
    expect(result).toEqual({ ok: true, value: { triageId: "trg-aaaa1111", title: "New title" } });
  });

  it("accepts title + detail + severity together", () => {
    const result = parseAmendBody({
      triageId: "trg-aaaa1111",
      title: "New title",
      detail: "New detail",
      severity: "high",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        triageId: "trg-aaaa1111",
        title: "New title",
        detail: "New detail",
        severity: "high",
      },
    });
  });

  it("rejects a non-object body", () => {
    expect(parseAmendBody(null)).toEqual({ ok: false, error: { error: "body_not_object" } });
    expect(parseAmendBody("x")).toEqual({ ok: false, error: { error: "body_not_object" } });
    expect(parseAmendBody([1, 2])).toEqual({ ok: false, error: { error: "body_not_object" } });
  });

  it("rejects a missing/malformed triageId", () => {
    expect(parseAmendBody({ title: "x" })).toEqual({
      ok: false,
      error: { error: "invalid_triageId", field: "triageId" },
    });
    expect(parseAmendBody({ triageId: "not-an-id", title: "x" })).toEqual({
      ok: false,
      error: { error: "invalid_triageId", field: "triageId" },
    });
  });

  it("rejects a contentless body (no title/detail/severity present)", () => {
    expect(parseAmendBody({ triageId: "trg-aaaa1111" })).toEqual({
      ok: false,
      error: { error: "amend_contentless" },
    });
  });

  it("rejects an invalid severity value", () => {
    expect(parseAmendBody({ triageId: "trg-aaaa1111", severity: "extreme" })).toEqual({
      ok: false,
      error: { error: "invalid_amend_field" },
    });
  });

  it("rejects a blank title", () => {
    expect(parseAmendBody({ triageId: "trg-aaaa1111", title: "   " })).toEqual({
      ok: false,
      error: { error: "invalid_amend_field" },
    });
  });

  it("ignores a `kind` field on the body — not accepted from the Edit UI", () => {
    const result = parseAmendBody({ triageId: "trg-aaaa1111", title: "x", kind: "bug" });
    expect(result).toEqual({ ok: true, value: { triageId: "trg-aaaa1111", title: "x" } });
  });
});
