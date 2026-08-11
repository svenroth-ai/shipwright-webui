/*
 * missionArtifacts.testsWording.ts — the Tests DETAIL headline, split out of
 * missionArtifacts.ts (which is at its bloat limit, 300 LOC).
 *
 * Mirrors the server's `resultsSentence` wording (artifacts-tests.ts) so the
 * rail receipt and panel headline never teach different things.
 */

import type { MissionTests } from "./missionContextApi";

/** Raw producer data, not yet validated — re-check before an "all skipped"
 *  claim rather than trust a truthy `skipped` (external code review, MEDIUM:
 *  mirrors the server's `isGenuinelyAllSkipped`). */
function isGenuinelyAllSkipped(passed: number | null, total: number | null, skipped: number | null): boolean {
  const isNonNegInt = (n: number | null): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return isNonNegInt(passed) && passed === 0 && isNonNegInt(total) && total > 0 && skipped === total;
}

export function hasReliableTestCounts(passed: number | null | undefined, total: number | null | undefined, skipped: number | null | undefined): boolean {
  const isNonNegInt = (n: number | null | undefined): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return isNonNegInt(passed) && isNonNegInt(total) && passed <= total &&
    (skipped == null || (isNonNegInt(skipped) && skipped <= total));
}

/** Null when nothing citable was recorded. */
export function testsResultText(results: MissionTests | null | undefined): string | null {
  if (!results) return null;
  const { passed, total, gate, skipped } = results;
  // A genuine zero-of-zero is not a result — never render "All 0 tests passing".
  if ((passed ?? 0) === 0 && (total ?? 0) === 0) return null;
  const word = (n: number): string => (n === 1 ? "test" : "tests");
  if (passed != null && total != null) {
    if (!hasReliableTestCounts(passed, total, skipped)) {
      return "No reliable result — the recorded test counts are incomplete or invalid";
    }
    // `unknown` with BOTH fields present = nothing citable despite full data
    // — never "passing" text (doubt review, MEDIUM). A partial record (only
    // ONE field) is a DIFFERENT "unknown" — the fallbacks below, unchanged.
    if (gate === "unknown") {
      return isGenuinelyAllSkipped(passed, total, skipped)
        ? `Needs attention — all ${total} collected ${word(total)} were skipped, so none ran`
        : "No reliable result — the recorded test counts are incomplete or invalid";
    }
    // `gate` is pre-resolved — never re-derive from passed===total. A skipped
    // green run is disclosed, not rounded up to "All N passing" (code review).
    if (gate === "pass" && (skipped ?? 0) > 0) {
      return `Passed — ${passed} of ${total} ${word(total)} passing (${skipped} skipped)`;
    }
    return gate === "pass"
      ? `Passed — all ${total} ${word(total)} passing`
      : `Failed — ${passed} of ${total} ${word(total)} passing`;
  }
  if (total != null || passed != null) return "No reliable result — the run recorded only part of its test counts";
  return null;
}
