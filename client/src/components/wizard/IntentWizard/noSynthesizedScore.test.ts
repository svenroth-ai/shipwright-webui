/*
 * AC2 — the honest n/a is load-bearing. There is NO code path that can
 * synthesize, estimate or default a score for an underivable dimension.
 *
 * This asserts it on two fronts:
 *   1. the stub data: every "n/a" dimension carries score === null (the renderer
 *      draws n/a from status, not from a number, so a null here can never become
 *      a bar or a value);
 *   2. the input guard: a payload that pairs status "n/a" with a number is
 *      REJECTED (parseReportModel), so a monorepo regression that started
 *      emitting a synthesized score for an n/a dimension surfaces as an honest
 *      "shape not recognised" instead of a fabricated bar.
 */

import { describe, it, expect } from "vitest";

import { GRADE_REPORT } from "./stubData";
import { parseReportModel } from "./reportShape";

describe("AC2 — no synthesized score for an underivable dimension", () => {
  it("every n/a dimension in the stub has score === null (never a number)", () => {
    const naDims = GRADE_REPORT.dimensions.filter((d) => d.status === "n/a");
    expect(naDims.length).toBeGreaterThan(0); // the cold-repo reference case exists
    for (const d of naDims) {
      expect(d.score, `${d.label} is n/a and must have a null score`).toBeNull();
    }
  });

  it("the reference n/a is Requirement traceability on a cold repo", () => {
    const trace = GRADE_REPORT.dimensions.find((d) => d.key === "requirement_traceability");
    expect(trace?.status).toBe("n/a");
    expect(trace?.score).toBeNull();
    expect(trace?.would_light_up).toBe(true);
  });

  it("the guard REJECTS a payload that synthesizes a score for an n/a dimension", () => {
    const poisoned = structuredClone(GRADE_REPORT) as unknown as {
      dimensions: Array<{ status: string; score: number | null }>;
    };
    // Simulate a monorepo regression: an n/a dimension that suddenly carries a number.
    const na = poisoned.dimensions.find((d) => d.status === "n/a");
    expect(na).toBeTruthy();
    na!.score = 0; // a "defaulted" score — exactly what AC2 forbids
    const result = parseReportModel(poisoned);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/synthesized|n\/a/i);
  });

  it("measurable dimensions keep their real numeric score", () => {
    const tests = GRADE_REPORT.dimensions.find((d) => d.key === "test_health");
    expect(tests?.status).not.toBe("n/a");
    expect(typeof tests?.score).toBe("number");
  });
});
