/*
 * missionWording.ts — plain-language wording for the S3 pipeline + campaign
 * details (CONTRACT §6 / §8).
 *
 * Split out of `missionArtifacts.ts` (300-LOC rule) along the seam that was
 * already drawn there: that file decides WHAT the user sees (order, hide-empty,
 * clickability), this one decides HOW it is worded. Nothing else moved and no
 * behaviour changed.
 *
 * The honesty rules travel with the words:
 *   - a null count NEVER becomes 0 ("not recorded", not "0 of 0 passed");
 *   - an `unavailable` review reads "no record", NEVER "passed" or "none".
 */

/** Plain-language unit/phase status. The raw enum is never shown. */
export function unitStatusWord(status: string): string {
  switch (status) {
    case "complete":
    case "done":
      return "complete";
    case "in_progress":
      return "running now";
    case "failed":
      return "failed";
    case "escalated":
      return "needs a decision";
    case "skipped":
      return "skipped";
    case "awaiting_launch":
      return "waiting to start";
    case "pending":
    case "backlog":
      return "not started";
    default:
      return status;
  }
}

/** Why this unit is the current one — the basis, stated rather than implied. */
export function selectionWord(selectedBy: "in_progress" | "first_incomplete" | "last_complete"): string {
  switch (selectedBy) {
    case "in_progress":
      return "It is running now.";
    case "first_incomplete":
      return "It is the first unit that has not finished.";
    case "last_complete":
      return "Every unit is complete; this was the last one.";
  }
}

/**
 * "5107 of 5108 passed", or an honest "not recorded".
 *
 * A null count NEVER becomes 0. Rendering an unrecorded result as "0 of 0
 * passed" would manufacture a pass out of missing data — the same shape as the
 * S2 finding where an unreadable findings count folded into "no issues".
 */
export function testCountLabel(passed: number | null, total: number | null): string {
  if (passed == null || total == null) return "not recorded";
  return `${passed} of ${total} passed`;
}

/**
 * The review status, in words.
 *
 * `unavailable` deliberately reads as "no record" and NEVER as "passed" or
 * "none" — an unreadable pass presented as a clean one is the single worst
 * failure this artifact could produce (CONTRACT §9.1).
 */
export function reviewStatusWord(
  status: "completed" | "not_run" | "not_applicable" | "unavailable",
): string {
  switch (status) {
    case "completed":
      return "ran";
    case "not_run":
      return "not run";
    // "did not apply" rather than "not run": the pass was never asked for at
    // this size, which is a different fact from choosing to skip one that was.
    case "not_applicable":
      return "did not apply";
    case "unavailable":
      return "no record";
  }
}
