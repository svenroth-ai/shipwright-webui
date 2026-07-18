/*
 * artifacts-slice2.review-decisions.test.ts — the REVIEW + DECISIONS state
 * tables (Slice-2 AC1/AC3/AC4, CONTRACT §6 / §9.1).
 *
 * Same discipline as the Tests suite: an unreadable source must reach a VISIBLE
 * `unavailable`, and only a genuine absence may hide. The Review cases
 * additionally pin the §9.1 honesty rule — a summary must never read as a clean
 * sweep while one of the four passes has no readable record.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildDecisionsArtifact, buildReviewArtifact } from "./artifacts-slice2.js";
import type { DecisionsLookup } from "./decisions.js";
import type { ReviewLookup } from "./review-state.js";
import type { ReviewRow } from "./types-slice2.js";
import { ABSENT, FOUND, reviewRow } from "./slice2-test-fixtures.js";

const FOUR_UNKNOWN: ReviewRow[] = [
  reviewRow({ reviewType: "plan" }),
  reviewRow({ reviewType: "code" }),
  reviewRow({ reviewType: "doubt" }),
  reviewRow({ reviewType: "external_code" }),
];

describe("buildReviewArtifact", () => {
  it("hides only when there is NO record and nothing failed to read", () => {
    const lookup: ReviewLookup = { rows: FOUR_UNKNOWN, hasRecord: false, sawUnreadable: false };
    expect(buildReviewArtifact(lookup).state).toBe("not_yet_created");
  });

  it("SHOWS `unavailable` when a record existed but could not be read", () => {
    const lookup: ReviewLookup = { rows: FOUR_UNKNOWN, hasRecord: false, sawUnreadable: true };
    const a = buildReviewArtifact(lookup);
    expect(a.state).toBe("unavailable");
    expect(a.note).toBeTruthy();
  });

  it("renders all four types with the unreadable ones stated explicitly (AC4)", () => {
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "completed", findingsCount: 8 }),
        reviewRow({ reviewType: "code", note: "no machine-readable record" }),
        reviewRow({ reviewType: "doubt", note: "no machine-readable record" }),
        reviewRow({ reviewType: "external_code", status: "completed", findingsCount: 3 }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    const a = buildReviewArtifact(lookup);
    expect(a.state).toBe("available");
    expect(a.detail?.rows.map((r) => r.reviewType)).toEqual([
      "plan",
      "code",
      "doubt",
      "external_code",
    ]);
    expect(a.summary).toContain("11 issues");
    // The sentence must NOT stop at the good news while two passes are unknown.
    expect(a.summary).toMatch(/2 further reviews are not recorded/i);
  });

  it("never claims a clean sweep while a pass is unreadable", () => {
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "completed", findingsCount: 0 }),
        reviewRow({ reviewType: "code" }),
        reviewRow({ reviewType: "doubt" }),
        reviewRow({ reviewType: "external_code", status: "not_run", note: "skipped" }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    const a = buildReviewArtifact(lookup);
    expect(a.summary).toContain("raised no issues");
    expect(a.summary).toMatch(/not recorded/i);
  });

  it("stays VISIBLE when every recorded pass says 'not run' (AC4)", () => {
    // External plan review, MEDIUM #7: a naive "has content" predicate would
    // hide this, and AC4 explicitly requires the four types to be rendered with
    // the missing ones stated. A run that deliberately skipped its reviews is
    // exactly the case a reader most needs to see.
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "not_run", note: "Not run — user opt out." }),
        reviewRow({ reviewType: "code" }),
        reviewRow({ reviewType: "doubt" }),
        reviewRow({ reviewType: "external_code", status: "not_run", note: "Not run — config disabled." }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    const a = buildReviewArtifact(lookup);
    expect(a.state).toBe("available");
    expect(a.detail?.rows).toHaveLength(4);
    // …and the summary must NOT read as a clean sweep. "0 reviews ran and
    // raised no issues" is literally true and completely misleading.
    expect(a.summary).toContain("No review was recorded as having run.");
    expect(a.summary).not.toMatch(/no issues/i);
    // …and it still discloses the two passes we cannot read.
    expect(a.summary).toMatch(/not recorded/i);
  });

  it("never reports 'raised no issues' when a completed pass's COUNT is unreadable", () => {
    // The bug this pins: `completed.reduce((n, r) => n + (r.findingsCount ?? 0))`
    // folded unknown into ZERO, so a marker that parsed as `completed` with a
    // missing/non-numeric `findings_count` produced "1 review ran and raised no
    // issues" — status honest, count fabricated. The `unknown` tally only
    // counted `unavailable` rows, so the disclosure tail did not fire either
    // (internal code review, MEDIUM).
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "completed", findingsCount: null }),
        reviewRow({ reviewType: "code" }),
        reviewRow({ reviewType: "doubt" }),
        reviewRow({ reviewType: "external_code", status: "not_run" }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    const a = buildReviewArtifact(lookup);
    expect(a.state).toBe("available");
    expect(a.summary).not.toMatch(/no issues/i);
    expect(a.summary).toContain("the findings were not recorded");
    // …and the unreadable count joins the disclosure tail (2 internal + 1 here).
    expect(a.summary).toMatch(/3 further reviews are not recorded/i);
  });

  it("counts issues only from passes whose count was READ, and discloses the rest", () => {
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "completed", findingsCount: 4 }),
        // Ran, count unreadable — must not silently contribute 0.
        reviewRow({ reviewType: "external_code", status: "completed", findingsCount: null }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    const a = buildReviewArtifact(lookup);
    expect(a.summary).toContain("4 issues raised across 1 review");
    expect(a.summary).toMatch(/1 further review is not recorded/i);
  });

  it("counts findings ONLY from passes that actually ran", () => {
    const lookup: ReviewLookup = {
      rows: [
        reviewRow({ reviewType: "plan", status: "completed", findingsCount: 4 }),
        reviewRow({ reviewType: "code" }),
        reviewRow({ reviewType: "doubt" }),
        // A `not_run` row carries no count; it must not be read as zero-and-fine.
        reviewRow({ reviewType: "external_code", status: "not_run" }),
      ],
      hasRecord: true,
      sawUnreadable: false,
    };
    expect(buildReviewArtifact(lookup).receipt).toBe("4 findings");
  });
});

describe("buildDecisionsArtifact", () => {
  it("SHOWS `unavailable` when the decision log could not be read", () => {
    const lookup: DecisionsLookup = { status: "unavailable", reason: "missing" };
    const a = buildDecisionsArtifact(lookup, FOUND);
    expect(a.state).toBe("unavailable");
    expect(a.note).toBeTruthy();
  });

  it("hides a finalized run that genuinely recorded no ADR", () => {
    const a = buildDecisionsArtifact({ status: "ok", entries: [], truncated: false }, FOUND);
    expect(a.state).toBe("not_applicable");
  });

  it("hides a mid-run session as not-yet rather than not-applicable", () => {
    const a = buildDecisionsArtifact({ status: "ok", entries: [], truncated: false }, ABSENT);
    expect(a.state).toBe("not_yet_created");
  });

  it("renders the run's ADRs with their own Markdown", () => {
    const a = buildDecisionsArtifact(
      {
        status: "ok",
        truncated: false,
        entries: [
          { adrId: "ADR-300", title: "Pick the review source", markdown: "### ADR-300\nbody" },
          { adrId: "ADR-301", title: "Bound the manifest", markdown: "### ADR-301\nbody" },
        ],
      },
      FOUND,
    );
    expect(a.state).toBe("available");
    expect(a.summary).toContain("Pick the review source");
    expect(a.receipt).toBe("ADR-300, ADR-301");
    expect(a.detail?.entries).toHaveLength(2);
  });
});
