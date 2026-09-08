import { describe, expect, it } from "vitest";

import { charterAuthorityCore, extractBandSections, CHARTER_BANDS } from "./charter-authority-read.js";
import type { OrgFileReadCoreResult } from "./file-read.js";

const ALL_FOUR = `# ${"lead"} charter

## Bugfix / bekannter Defekt
Fix small, well-understood defects without asking.

## Kleine Pflege
Routine upkeep — dependency bumps, lint fixes.

## Neues Feature
Never ship a new feature without a PO sign-off first.

## Architektur / Grundsatz
Always ask before an architectural change.
`;

describe("extractBandSections", () => {
  it("extracts prose for all 4 declared bands", () => {
    const result = extractBandSections(ALL_FOUR);
    expect(result).toHaveLength(4);
    const bugfix = result.find((b) => b.id === "bugfix")!;
    expect(bugfix.declared).toBe(true);
    expect(bugfix.text).toContain("Fix small, well-understood defects");
  });

  it("marks a missing band as not declared with null text", () => {
    const twoOfFour = `## Bugfix / bekannter Defekt\nFix typos.\n\n## Kleine Pflege\nRoutine upkeep.\n`;
    const result = extractBandSections(twoOfFour);
    const feature = result.find((b) => b.id === "feature")!;
    expect(feature.declared).toBe(false);
    expect(feature.text).toBeNull();
  });

  it("matches heading text with different slash-spacing (boundary case mirrored from leadwright)", () => {
    const tight = `## Bugfix/bekannter Defekt\nFix typos.\n`;
    const result = extractBandSections(tight);
    expect(result.find((b) => b.id === "bugfix")!.declared).toBe(true);
  });

  it("returns null text for a heading present with an empty section", () => {
    const emptySection = `## Bugfix / bekannter Defekt\n\n## Kleine Pflege\nRoutine upkeep.\n`;
    const result = extractBandSections(emptySection);
    const bugfix = result.find((b) => b.id === "bugfix")!;
    expect(bugfix.declared).toBe(true);
    expect(bugfix.text).toBeNull();
  });

  it("has exactly the 4 canonical band ids in CHARTER_BANDS", () => {
    expect(CHARTER_BANDS.map((b) => b.id)).toEqual(["bugfix", "maintenance", "feature", "architecture"]);
  });
});

describe("charterAuthorityCore", () => {
  const okRead = (): OrgFileReadCoreResult => ({
    status: 200,
    kind: "file",
    headers: {},
    body: Buffer.from(ALL_FOUR, "utf8"),
  });

  it("measured:true with 4/4 declared for a well-formed charter", () => {
    const result = charterAuthorityCore({ leadsRoot: "/leads", readFn: okRead }, "lead-a", "charter.md");
    expect(result.measured).toBe(true);
    if (result.measured) {
      expect(result.declaredCount).toBe(4);
      expect(result.bands).toHaveLength(4);
    }
  });

  it("measured:false with a default-path reason when the read fails", () => {
    const failRead = (): OrgFileReadCoreResult => ({
      status: 404,
      kind: "json",
      body: { error: "not_found" },
    });
    const result = charterAuthorityCore({ leadsRoot: "/leads", readFn: failRead }, "lead-a", "charter.md");
    expect(result.measured).toBe(false);
    if (!result.measured) {
      expect(result.reason).toMatch(/default charter path/);
    }
  });

  it("measured:false with a custom-path reason when charter_path is non-default", () => {
    const result = charterAuthorityCore(
      { leadsRoot: "/leads", readFn: okRead },
      "lead-a",
      "docs/authority.md",
    );
    expect(result.measured).toBe(false);
    if (!result.measured) {
      expect(result.reason).toMatch(/custom charter path/);
    }
  });
});
