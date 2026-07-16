/*
 * Shape-guard tests (A08) — the cross-repo contract boundary. The grade card
 * renders the plugin's ReportModel; a renamed/dropped field or a bumped major
 * must produce an honest "shape not recognised", never a half-empty card.
 */

import { describe, it, expect } from "vitest";

import { GRADE_REPORT } from "./stubData";
import { parseReportModel, SUPPORTED_REPORT_MAJOR } from "./reportShape";

describe("parseReportModel", () => {
  it("accepts the real ReportModel shape (the stub is contract-faithful)", () => {
    const r = parseReportModel(GRADE_REPORT);
    expect(r.ok).toBe(true);
  });

  it("refuses a newer MAJOR schema_version rather than half-rendering", () => {
    const bumped = { ...GRADE_REPORT, schema_version: `${SUPPORTED_REPORT_MAJOR + 1}.0` };
    const r = parseReportModel(bumped);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/newer major/i);
  });

  it("accepts a newer MINOR (additive) — a new field must not force a WebUI release", () => {
    const minor = { ...GRADE_REPORT, schema_version: "1.9", some_new_additive_field: 42 };
    expect(parseReportModel(minor).ok).toBe(true);
  });

  it("rejects a missing/garbled schema_version", () => {
    const { schema_version: _omit, ...noVer } = GRADE_REPORT;
    void _omit;
    expect(parseReportModel(noVer).ok).toBe(false);
  });

  it("rejects a dimension whose status is outside {ok,gap,n/a}", () => {
    const bad = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ status: string }>;
    };
    bad.dimensions[0].status = "unknown";
    expect(parseReportModel(bad).ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(parseReportModel(null).ok).toBe(false);
    expect(parseReportModel("nope").ok).toBe(false);
    expect(parseReportModel([]).ok).toBe(false);
  });

  it("rejects when dimensions is not an array", () => {
    expect(parseReportModel({ ...GRADE_REPORT, dimensions: {} }).ok).toBe(false);
  });

  it("rejects a payload missing `reasons` — GradeResult .map()s it, so an absent array would THROW (A09b)", () => {
    const { reasons: _drop, ...noReasons } = GRADE_REPORT;
    void _drop;
    const r = parseReportModel(noReasons);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/reasons/i);
    // The other consumed scalars are guarded too (drift → shape-unrecognised, not a crash).
    for (const field of ["mode", "routing_reason", "verified_from", "network_note", "static_test_inventory"]) {
      const { [field]: _o, ...missing } = GRADE_REPORT as unknown as Record<string, unknown>;
      void _o;
      expect(parseReportModel(missing).ok, `missing ${field} must be rejected`).toBe(false);
    }
    expect(parseReportModel({ ...GRADE_REPORT, network_enabled: "yes" }).ok).toBe(false);
  });

  it("rejects a dimension missing its provenance object", () => {
    const bad = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<Record<string, unknown>>;
    };
    delete bad.dimensions[0].provenance;
    expect(parseReportModel(bad).ok).toBe(false);
  });

  it("rejects a dimension missing a field the row renders (key/weight/detail)", () => {
    for (const field of ["key", "weight", "detail", "would_light_up"]) {
      const bad = structuredClone(GRADE_REPORT) as unknown as {
        dimensions: Array<Record<string, unknown>>;
      };
      delete bad.dimensions[1][field];
      expect(parseReportModel(bad).ok, `missing ${field} must be rejected`).toBe(false);
    }
  });

  it("rejects provenance.disabled_enrichments that is not an array (would crash .length)", () => {
    const bad = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ provenance: Record<string, unknown> }>;
    };
    bad.dimensions[0].provenance.disabled_enrichments = "oops";
    expect(parseReportModel(bad).ok).toBe(false);
  });

  it("rejects an ok/gap dimension whose score is null (would render null/100)", () => {
    const bad = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ status: string; score: number | null }>;
    };
    const scored = bad.dimensions.find((d) => d.status !== "n/a");
    expect(scored).toBeTruthy();
    scored!.score = null;
    const r = parseReportModel(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/finite number/i);
  });

  it("rejects a non-finite score", () => {
    const bad = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ status: string; score: number | null }>;
    };
    const scored = bad.dimensions.find((d) => d.status !== "n/a");
    scored!.score = Number.POSITIVE_INFINITY as unknown as number;
    expect(parseReportModel(bad).ok).toBe(false);
  });

  it("rejects aggregate counts that disagree with the dimensions", () => {
    const bad = { ...GRADE_REPORT, na_count: 99 };
    const r = parseReportModel(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/na_count/i);

    const bad2 = { ...GRADE_REPORT, measurable_count: 0 };
    expect(parseReportModel(bad2).ok).toBe(false);
  });
});

describe("the shipped stub is contract-consistent", () => {
  it("na_count / measurable_count match the dimensions (no misrepresented aggregate)", () => {
    const na = GRADE_REPORT.dimensions.filter((d) => d.status === "n/a").length;
    expect(GRADE_REPORT.na_count).toBe(na);
    expect(GRADE_REPORT.measurable_count).toBe(GRADE_REPORT.dimensions.length - na);
    // Two of four cannot be derived — the pitch the verdict makes.
    expect(na).toBe(2);
  });
});
