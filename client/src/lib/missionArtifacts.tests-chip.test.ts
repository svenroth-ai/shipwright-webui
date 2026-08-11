/*
 * missionArtifacts.tests-chip.test.ts — the Tests artifact's Instruments chip
 * + counts-led detail headline (CONTRACT §6 AC8). Split out of
 * missionArtifacts.test.ts, which is at its bloat limit (300 LOC).
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { servesChipValue, testsChipValue, testsResultText } from "./missionArtifacts";
import type { ArtifactDescriptor, ArtifactState, MissionContext } from "./missionContextApi";

function spec(state: ArtifactState): ArtifactDescriptor {
  return {
    kind: "spec",
    label: "Spec",
    state,
    summary: state === "available" ? "The plan." : null,
    receipt: state === "available" ? "mini-plan.md" : null,
    detail: state === "available" ? { type: "document", documentId: "id", title: "mini-plan.md" } : null,
  };
}

function ctx(over: Partial<MissionContext> = {}): MissionContext {
  return {
    schemaVersion: 1,
    scenario: "iterate",
    missionTabVisible: true,
    runId: "iterate-2026-07-18-demo",
    runLive: false,
    artifacts: [spec("available")],
    tests: null,
    servesFrId: null,
    sourceRev: "abc",
    ...over,
  };
}

describe("instrument chips (AC8 — honest or dash)", () => {
  it("renders passed/total when both are present", () => {
    const tests = { passed: 12, total: 12, skipped: null, gate: "pass" as const };
    expect(testsChipValue(ctx({ tests }))).toBe("12/12");
  });

  it("returns null on a PARTIAL record — never invents a denominator", () => {
    expect(testsChipValue(ctx({ tests: { passed: 12, total: null, skipped: null, gate: "unknown" } }))).toBeNull();
    expect(testsChipValue(ctx({ tests: { passed: null, total: 12, skipped: null, gate: "unknown" } }))).toBeNull();
    expect(testsChipValue(ctx({ tests: null }))).toBeNull();
  });

  it("renders a zero-passed suite honestly rather than as absent", () => {
    const tests = { passed: 0, total: 9, skipped: null, gate: "fail" as const };
    expect(testsChipValue(ctx({ tests }))).toBe("0/9");
  });

  it("serves the fold-resolved FR id, or null", () => {
    expect(servesChipValue(ctx({ servesFrId: "FR-01.66" }))).toBe("FR-01.66");
    expect(servesChipValue(ctx({ servesFrId: null }))).toBeNull();
  });
});

describe("testsResultText (the counts-led detail headline)", () => {
  it("leads a green suite with Passed", () => {
    expect(testsResultText({ passed: 3037, total: 3037, skipped: null, gate: "pass" })).toBe(
      "Passed — all 3037 tests passing",
    );
  });

  it("leads a failed suite with Failed — never rounds to green", () => {
    expect(testsResultText({ passed: 3009, total: 3037, skipped: null, gate: "fail" })).toBe(
      "Failed — 3009 of 3037 tests passing",
    );
  });

  it("labels partial counts as having no reliable result", () => {
    expect(testsResultText({ passed: null, total: 42, skipped: null, gate: "unknown" })).toBe("No reliable result — the run recorded only part of its test counts");
    expect(testsResultText({ passed: 7, total: null, skipped: null, gate: "unknown" })).toBe("No reliable result — the run recorded only part of its test counts");
  });

  it("singularises a one-test suite", () => {
    expect(testsResultText({ passed: 1, total: 1, skipped: null, gate: "pass" })).toBe("Passed — all 1 test passing");
  });

  it("a post-reversal host-gated skip discloses the skip count rather than 'All N passing' (discriminating case)", () => {
    expect(testsResultText({ passed: 9, total: 10, skipped: 1, gate: "pass" })).toBe(
      "Passed — 9 of 10 tests passing (1 skipped)",
    );
  });

  it("a green run with no skips still says 'All N passing'", () => {
    expect(testsResultText({ passed: 10, total: 10, skipped: 0, gate: "pass" })).toBe(
      "Passed — all 10 tests passing",
    );
  });

  it("a post-reversal ALL-skipped run discloses 'skipped — none ran', never fail-shaped 'passing' text (doubt review, MEDIUM)", () => {
    expect(testsResultText({ passed: 0, total: 5, skipped: 5, gate: "unknown" })).toBe(
      "Needs attention — all 5 collected tests were skipped, so none ran",
    );
  });

  it("an unknown gate with no citable skip count falls back to a plain 'no result' phrase", () => {
    expect(testsResultText({ passed: 0, total: 0, skipped: null, gate: "unknown" })).toBeNull();
    expect(testsResultText({ passed: 5, total: 0, skipped: null, gate: "unknown" })).toBe(
      "No reliable result — the recorded test counts are incomplete or invalid",
    );
  });

  it("a MALFORMED unknown record never claims 'all N were skipped' -- only the raw counts, not a truthy skipped, may license that (external code review, MEDIUM)", () => {
    // skipped(9) != total(5): the record does not prove every collected test
    // was skipped, just that it is broken.
    expect(testsResultText({ passed: 0, total: 5, skipped: 9, gate: "unknown" })).toBe(
      "No reliable result — the recorded test counts are incomplete or invalid",
    );
    // negative passed -- skipped(1) is genuine but does not prove ALL 5 were skipped.
    expect(testsResultText({ passed: -1, total: 5, skipped: 1, gate: "unknown" })).toBe(
      "No reliable result — the recorded test counts are incomplete or invalid",
    );
  });

  it("suppresses malformed producer-pass counts rather than showing a green chip", () => {
    expect(testsChipValue(ctx({ tests: { passed: 5, total: 5, skipped: -1, gate: "pass" } }))).toBeNull();
    expect(testsChipValue(ctx({ tests: { passed: 5, total: 5, skipped: 0.5, gate: "pass" } }))).toBeNull();
  });

  it("never lets malformed skips greenwash a producer-pass gate", () => {
    expect(testsResultText({ passed: 5, total: 5, skipped: -1, gate: "pass" })).toBe(
      "No reliable result — the recorded test counts are incomplete or invalid",
    );
    expect(testsResultText({ passed: 5, total: 5, skipped: 0.5, gate: "pass" })).toBe(
      "No reliable result — the recorded test counts are incomplete or invalid",
    );
  });

  it("returns null when nothing citable was recorded", () => {
    expect(testsResultText(null)).toBeNull();
    expect(testsResultText({ passed: null, total: null, skipped: null, gate: "unknown" })).toBeNull();
  });

  it("treats a genuine zero-of-zero as no result — never 'All 0 tests passing'", () => {
    expect(testsResultText({ passed: 0, total: 0, skipped: null, gate: "unknown" })).toBeNull();
  });

  it("still reports a real failing run (0 of N)", () => {
    expect(testsResultText({ passed: 0, total: 9, skipped: null, gate: "fail" })).toBe("Failed — 0 of 9 tests passing");
  });
});
