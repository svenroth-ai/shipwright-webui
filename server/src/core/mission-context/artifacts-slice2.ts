/*
 * core/mission-context/artifacts-slice2.ts — the Review descriptor
 * (CONTRACT §6 row 4, campaign 2026-07-18-mission-artifacts).
 *
 * Tests (row 3) moved to `artifacts-tests.ts` and Decisions (row 5) to
 * `artifacts-decisions.ts` as each grew; the state discipline described in
 * those files governs this one alike.
 *
 * Same register as artifacts.ts: Mission is FOR NON-EXPERTS, so every `summary`
 * says what the thing MEANS, never which file it came from.
 *
 * The failure mode this file exists to prevent is a summary that reads as a
 * clean sweep while one of the four passes has no readable record. Those two
 * must never collapse.
 */

import type { ReviewLookup } from "./review-state.js";
import type { ReviewArtifact, ReviewRow } from "./types-slice2.js";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const REVIEW_WORD: Record<ReviewRow["reviewType"], string> = {
  self: "the self-review",
  plan: "the plan review",
  code: "the code review",
  doubt: "the doubt review",
  external_code: "the external code review",
};

export function buildReviewArtifact(lookup: ReviewLookup): ReviewArtifact {
  // No record at all AND nothing that failed to read: this run simply has no
  // review history to show. Hidden — an absence, not a fault.
  if (!lookup.hasRecord && !lookup.sawUnreadable) {
    return {
      kind: "review",
      label: "Review",
      state: "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  // Something existed and could not be read — an integrity signal, shown.
  if (!lookup.hasRecord) {
    return {
      kind: "review",
      label: "Review",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "This run's review records could not be read.",
      detail: null,
    };
  }

  // A review that RAN but whose findings count could not be read is its own
  // fact, and it must not be folded into zero. `completed.reduce(n + (count ??
  // 0))` treated "unknown" as "none", so a marker with a missing or non-numeric
  // `findings_count` produced "1 review ran and raised no issues" — the status
  // honest, the count fabricated. That is the same unreadable→clean collapse the
  // state enum prevents one level up (internal code review, MEDIUM).
  const completed = lookup.rows.filter((r) => r.status === "completed");
  // An UNSTRUCTURED parse is the same collapse in a new disguise: the review ran,
  // its prose could not be itemized, so its count is 0 for a review that may have
  // found plenty. Counting it would make the SUMMARY — the first line a reader
  // sees, above the renderer's caveat — say "raised no issues". The renderer was
  // taught this; the summary had to be taught it too.
  const counted = completed.filter(
    (r) => r.findingsCount != null && r.parseStatus !== "unstructured",
  );
  const uncounted = completed.length - counted.length;
  const findings = counted.reduce((n, r) => n + (r.findingsCount ?? 0), 0);
  // Anything whose RESULT we cannot state: unreadable passes, plus completed
  // passes with an unreadable count.
  const unknown = lookup.rows.filter((r) => r.status === "unavailable").length + uncounted;

  // Every "no issues" claim below is made ONLY about passes whose count we
  // actually read (`counted`). "0 reviews ran and raised no issues" would read
  // as a clean sweep when nothing ran; "1 review ran and raised no issues"
  // would do the same when the count was simply unreadable. Both are the
  // false assurance §9.1 forbids, so each gets its own honest sentence.
  const lead =
    completed.length === 0
      ? "No review was recorded as having run."
      : counted.length === 0
        ? `${plural(completed.length, "review", "reviews")} ran, but the findings were not recorded.`
        : findings
          ? `${plural(findings, "issue", "issues")} raised across ${plural(counted.length, "review", "reviews")}.`
          : `${plural(counted.length, "review", "reviews")} ran and raised no issues.`;
  // Never let the sentence stop at the good news while passes are unreadable.
  const tail = unknown
    ? ` ${plural(unknown, "further review is", "further reviews are")} not recorded, so ${unknown === 1 ? "its" : "their"} result is unknown.`
    : "";

  return {
    kind: "review",
    label: "Review",
    state: "available",
    summary: `${lead}${tail}`,
    receipt: findings ? plural(findings, "finding", "findings") : `${completed.length} reviewed`,
    detail: { type: "reviews", rows: lookup.rows },
  };
}

/** Plain-language name for a review type — used by the client too (mirrored). */
export function reviewWord(t: ReviewRow["reviewType"]): string {
  return REVIEW_WORD[t];
}
