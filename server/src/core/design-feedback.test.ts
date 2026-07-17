/*
 * design-feedback.test.ts — the disk-derived round number (AC3) + the
 * contract-preserving heading rewrite (AC4). Pure, no filesystem.
 */

import { describe, it, expect } from "vitest";

import {
  computeNextRound,
  roundOfFileName,
  roundFileName,
  normalizeRoundHeading,
  looksLikeDesignFeedback,
} from "./design-feedback.js";

describe("roundOfFileName", () => {
  // @covers FR-01.45
  it("captures the round integer from a round file", () => {
    expect(roundOfFileName("design-feedback-round1.md")).toBe(1);
    expect(roundOfFileName("design-feedback-round12.md")).toBe(12);
  });
  // @covers FR-01.45
  it("is case-insensitive on the extension/name", () => {
    expect(roundOfFileName("Design-Feedback-Round3.MD")).toBe(3);
  });
  // @covers FR-01.45
  it("ignores non-round files", () => {
    expect(roundOfFileName("index.html")).toBeNull();
    expect(roundOfFileName("visual-guidelines.md")).toBeNull();
    expect(roundOfFileName("design-feedback.md")).toBeNull();
    expect(roundOfFileName("design-feedback-roundX.md")).toBeNull();
    expect(roundOfFileName("design-feedback-round1.md.bak")).toBeNull();
  });
  // @covers FR-01.45
  it("rejects round0 (rounds are 1-based)", () => {
    expect(roundOfFileName("design-feedback-round0.md")).toBeNull();
  });
});

describe("computeNextRound (AC3 — disk-derived, not localStorage)", () => {
  // @covers FR-01.45
  it("returns 1 for an empty directory", () => {
    expect(computeNextRound([])).toBe(1);
  });
  // @covers FR-01.45
  it("returns 1 when no round files exist", () => {
    expect(computeNextRound(["index.html", "visual-guidelines.md", "screens"])).toBe(1);
  });
  // @covers FR-01.45
  it("returns max+1", () => {
    expect(computeNextRound(["design-feedback-round1.md"])).toBe(2);
    expect(
      computeNextRound(["design-feedback-round1.md", "design-feedback-round2.md"]),
    ).toBe(3);
  });
  // @covers FR-01.45
  it("fills to max+1 across a gap (not gap+1)", () => {
    expect(
      computeNextRound(["design-feedback-round1.md", "design-feedback-round3.md"]),
    ).toBe(4);
  });
  // @covers FR-01.45
  it("compares numerically, not lexically (round10 > round2)", () => {
    expect(
      computeNextRound([
        "design-feedback-round2.md",
        "design-feedback-round10.md",
      ]),
    ).toBe(11);
  });
  // @covers FR-01.45
  it("ignores interleaved non-round files", () => {
    expect(
      computeNextRound([
        "index.html",
        "design-feedback-round4.md",
        "visual-guidelines.md",
      ]),
    ).toBe(5);
  });
});

describe("roundFileName", () => {
  // @covers FR-01.45
  it("builds the canonical name", () => {
    expect(roundFileName(3)).toBe("design-feedback-round3.md");
  });
});

describe("looksLikeDesignFeedback (contract guard — first-line heading)", () => {
  // @covers FR-01.45
  it("accepts the viewer heading on line 1", () => {
    expect(looksLikeDesignFeedback("# Design Feedback — Round 1\n\n...")).toBe(true);
    expect(looksLikeDesignFeedback("# Design Feedback - Round 12\nbody")).toBe(true);
  });
  // @covers FR-01.45
  it("rejects arbitrary markdown", () => {
    expect(looksLikeDesignFeedback("# Something Else\n")).toBe(false);
    expect(looksLikeDesignFeedback("just text")).toBe(false);
  });
  // @covers FR-01.45
  it("rejects when the heading is NOT on line 1 (review #2)", () => {
    expect(looksLikeDesignFeedback("intro\n# Design Feedback — Round 1\n")).toBe(false);
  });
  // @covers FR-01.45
  it("rejects a Design Feedback heading without a round number", () => {
    expect(looksLikeDesignFeedback("# Design Feedback (draft)\n")).toBe(false);
  });
});

// The exact bytes the emitted viewer's exportFeedback() produces (em-dash).
const VIEWER_MD = [
  "# Design Feedback — Round 1",
  "",
  "> Exported: 2026-07-10",
  "",
  "## Summary",
  "",
  "| Status | Count |",
  "|--------|-------|",
  "| Approved | 2 |",
  "| Changes Requested | 1 |",
  "| Rejected | 0 |",
  "| Total Reviewed | 3 / 5 |",
  "",
  "## Core",
  "",
  "### #01 Dashboard — CHANGES",
  "",
  "**File:** screens/01-dashboard.html  ",
  "**FRs:** FR-01.09",
  "",
  "Move the CTA above the fold. Revisit in Round 2 if it still feels cramped.",
  "",
  "---",
  "",
].join("\n");

describe("normalizeRoundHeading (AC4 — rewrite round only, preserve the rest)", () => {
  // @covers FR-01.45
  it("rewrites the heading round integer to N", () => {
    const out = normalizeRoundHeading(VIEWER_MD, 3);
    expect(out).toContain("# Design Feedback — Round 3");
    expect(out).not.toContain("# Design Feedback — Round 1");
  });

  // @covers FR-01.45
  it("preserves the em-dash and every other byte (only the digit changes)", () => {
    const out = normalizeRoundHeading(VIEWER_MD, 3);
    // Exactly one character differs: '1' → '3' on the heading line.
    expect(out).toBe(VIEWER_MD.replace("Round 1", "Round 3"));
  });

  // @covers FR-01.45
  it("does NOT touch a 'Round N' that appears inside free-text notes", () => {
    // The note body mentions "Round 2" — it must survive untouched.
    const out = normalizeRoundHeading(VIEWER_MD, 7);
    expect(out).toContain("Revisit in Round 2 if it still feels cramped.");
    expect(out).toContain("# Design Feedback — Round 7");
  });

  // @covers FR-01.45
  it("is idempotent when the heading already has N", () => {
    const once = normalizeRoundHeading(VIEWER_MD, 4);
    expect(normalizeRoundHeading(once, 4)).toBe(once);
  });

  // @covers FR-01.45
  it("accepts a hyphen-minus dash variant too", () => {
    const hyphen = "# Design Feedback - Round 1\n\nbody\n";
    expect(normalizeRoundHeading(hyphen, 9)).toBe("# Design Feedback - Round 9\n\nbody\n");
  });

  // @covers FR-01.45
  it("leaves a heading-less body unchanged", () => {
    expect(normalizeRoundHeading("no heading here", 2)).toBe("no heading here");
  });
});
