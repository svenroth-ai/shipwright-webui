/*
 * planned-impact.test.ts — mid-run planned impact (CONTRACT §6, AC1).
 *
 * Two defects pinned here (internal code review, MEDIUM):
 *   1. a document-wide FR scrape reported References / prior-art citations as
 *      "Expected to affect …";
 *   2. a spec with no literal FR id produced zero rows -> `not_yet_created` ->
 *      the client's hide-empty rule removed the artifact, so AC1 failed with
 *      NO signal.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { extractImpactSection, plannedImpactFromSpec } from "./planned-impact.js";

const SPEC_WITH_SECTION = [
  "# Wire the Mission tab",
  "",
  "Some intro prose that mentions FR-01.99 in passing.",
  "",
  "## Affected Boundaries",
  "",
  "The mission-context response shape (FR-01.66) and its client mirror.",
  "",
  "## References",
  "",
  "Prior art: FR-01.28 (embedded terminal) — unchanged by this run.",
  "",
].join("\n");

describe("extractImpactSection", () => {
  it("slices from the heading to the next same-level heading", () => {
    const s = extractImpactSection(SPEC_WITH_SECTION);
    expect(s).toContain("FR-01.66");
    expect(s).not.toContain("FR-01.28"); // that lives under References
    expect(s).not.toContain("FR-01.99"); // that is intro prose
  });

  it("keeps DEEPER sub-headings inside the section", () => {
    const s = extractImpactSection(
      ["## Affected Boundaries", "", "top", "", "### Detail", "", "FR-01.42", "", "## Next", "", "no"].join("\n"),
    );
    expect(s).toContain("FR-01.42");
    expect(s).not.toContain("no");
  });

  it("accepts the alternate headings real specs use", () => {
    for (const heading of [
      "## Spec impact",
      "### Requirements impact",
      "## Affected Requirements",
      "## Scope",
    ]) {
      expect(extractImpactSection(`${heading}\n\nFR-01.07 is touched.\n`), heading).toContain(
        "FR-01.07",
      );
    }
  });

  it("returns null when the spec has no impact section", () => {
    expect(extractImpactSection("# Title\n\nJust prose.\n")).toBeNull();
  });
});

describe("plannedImpactFromSpec", () => {
  it("reports ONLY the ids inside the impact section (no citations)", () => {
    const p = plannedImpactFromSpec(SPEC_WITH_SECTION);
    expect(p.frIds).toEqual(["FR-01.66"]);
  });

  it("carries the section prose so the artifact can render without ids", () => {
    const p = plannedImpactFromSpec(SPEC_WITH_SECTION);
    expect(p.prose).toContain("mission-context response shape");
  });

  it("yields NO ids but real prose when the spec names no FR at all (AC1)", () => {
    const p = plannedImpactFromSpec(
      ["# Fix the flake", "", "## Affected Boundaries", "", "The snapshot envelope written by the server and read by the E2E harness.", ""].join("\n"),
    );
    expect(p.frIds).toEqual([]);
    expect(p.prose).toContain("snapshot envelope");
  });

  it("does NOT scrape ids from a spec with no impact section", () => {
    // The whole point: a References-only mention must not become "impact".
    const p = plannedImpactFromSpec("# Title\n\nSee FR-01.28 for background.\n");
    expect(p.frIds).toEqual([]);
    expect(p.prose).toContain("background");
  });

  it("falls back to the first real paragraph for prose, skipping the title", () => {
    const p = plannedImpactFromSpec("# A title\n\nThe actual intent line.\n\nMore.\n");
    expect(p.prose).toBe("The actual intent line.");
  });

  it("condenses bullets and tables into one readable line", () => {
    const p = plannedImpactFromSpec(
      ["## Affected Boundaries", "", "- the resolver response", "- the client mirror", ""].join("\n"),
    );
    expect(p.prose).toBe("the resolver response the client mirror");
  });

  it("bounds a long section rather than emitting a wall of text", () => {
    const long = "word ".repeat(500);
    const p = plannedImpactFromSpec(`## Affected Boundaries\n\n${long}\n`);
    expect(p.prose!.length).toBeLessThanOrEqual(241);
    expect(p.prose!.endsWith("…")).toBe(true);
  });

  it("is empty for an absent spec", () => {
    expect(plannedImpactFromSpec(null)).toEqual({ frIds: [], prose: null });
    expect(plannedImpactFromSpec("")).toEqual({ frIds: [], prose: null });
  });
});
