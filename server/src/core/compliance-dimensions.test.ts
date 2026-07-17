import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseDimensions } from "./compliance-dimensions.js";
import { parseDashboard } from "./compliance-reader.js";

const FIXTURE_RAW = readFileSync(
  join(__dirname, "..", "test", "fixtures", "compliance-dashboard-sample.md"),
  "utf-8",
);

/** The Control-Verdict slice the reader would hand parseDimensions. */
function controlSlice(): string {
  const r = parseDashboard(FIXTURE_RAW);
  if (r.status !== "ok") throw new Error("fixture expected ok");
  return r.data.controlVerdictMarkdown;
}

describe("parseDimensions — table present (A16 AC2)", () => {
  it("parses every dimension row into { key, label, value, pct, doc }", () => {
    const dims = parseDimensions(controlSlice());
    expect(dims).toHaveLength(7);

    const test = dims.find((d) => d.label === "Test health");
    expect(test).toBeDefined();
    expect(test!.key).toBe("test-health");
    expect(test!.value).toContain("3464/3464");
    // ✅ verdict glyph → full bar (mirrors the dashboard's own per-dim verdict).
    expect(test!.pct).toBe(100);
    expect(test!.doc).toContain("OpenSSF Scorecard");
  });

  it("keys are unique and stable slugs of the label", () => {
    const dims = parseDimensions(controlSlice());
    const keys = dims.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("requirement-traceability");
    expect(keys).toContain("security");
  });

  it("reads the value verbatim — never a scraped fraction (honesty)", () => {
    const dims = parseDimensions(controlSlice());
    // "Change reconciliation" signal is bad-over-total ("0/22 not re-verified");
    // a naive ratio would render a near-empty bar. We show the ✅ verdict (100)
    // and keep the full signal as the value.
    const recon = dims.find((d) => d.label === "Change reconciliation");
    expect(recon!.value).toContain("0/22 behavior-touched FRs not re-verified");
    expect(recon!.pct).toBe(100);
  });
});

describe("parseDimensions — absent / malformed → [] (never throw)", () => {
  it("returns [] when there is no dimension table", () => {
    expect(parseDimensions("### Control Grade: **A** (99/100)\n\nno table here\n")).toEqual([]);
  });

  it("returns [] for an empty slice", () => {
    expect(parseDimensions("")).toEqual([]);
  });

  it("returns [] (no throw) for a header with no data rows", () => {
    const md = ["| | Dimension | Signal | Anchor |", "|---|---|---|---|"].join("\n");
    expect(parseDimensions(md)).toEqual([]);
  });

  it("returns [] (no throw) for a torn table — a header but ragged/absent cells", () => {
    const md = ["| | Dimension |", "garbage line", "| ✅ |"].join("\n");
    expect(() => parseDimensions(md)).not.toThrow();
    expect(parseDimensions(md)).toEqual([]);
  });
});

describe("parseDimensions — column-driven + status mapping", () => {
  it("resolves columns by header name even when reordered", () => {
    const md = [
      "| Signal | Dimension | Anchor | |",
      "|---|---|---|---|",
      "| ok now | Test health | OpenSSF | ✅ |",
    ].join("\n");
    const dims = parseDimensions(md);
    expect(dims).toHaveLength(1);
    expect(dims[0]!.label).toBe("Test health");
    expect(dims[0]!.value).toBe("ok now");
    expect(dims[0]!.doc).toBe("OpenSSF");
    expect(dims[0]!.pct).toBe(100);
  });

  it("maps ✅ → 100, ⚠️ → 60, ❌ → 25, unknown glyph → null", () => {
    const md = [
      "| | Dimension | Signal | Anchor |",
      "|---|---|---|---|",
      "| ✅ | A | a | x |",
      "| ⚠️ | B | b | y |",
      "| ❌ | C | c | z |",
      "|  | D | d | w |",
    ].join("\n");
    const dims = parseDimensions(md);
    expect(dims.map((d) => d.pct)).toEqual([100, 60, 25, null]);
  });
});
