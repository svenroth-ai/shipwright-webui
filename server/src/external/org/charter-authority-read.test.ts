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

  it("a UTF-8 BOM on the first line does not corrupt a later band heading (boundary probe)", () => {
    const withBom = `﻿# Lead charter\n\n## Bugfix / bekannter Defekt\nFix small defects.\n`;
    const result = extractBandSections(withBom);
    expect(result.find((b) => b.id === "bugfix")!.declared).toBe(true);
  });

  it("non-ASCII prose (umlauts, em-dash) round-trips intact (boundary probe)", () => {
    const md = `## Bugfix / bekannter Defekt\nRoutine-Wartung — ändert nichts an der Architektur, München-Style.\n`;
    const result = extractBandSections(md);
    const text = result.find((b) => b.id === "bugfix")!.text;
    expect(text).toContain("München-Style");
    expect(text).toContain("ändert");
  });

  it("CRLF line endings are tolerated the same as LF (boundary probe)", () => {
    const crlf = ["## Bugfix / bekannter Defekt", "Fix small defects.", "", "## Kleine Pflege", "Routine upkeep."].join(
      "\r\n",
    );
    const result = extractBandSections(crlf);
    const bugfix = result.find((b) => b.id === "bugfix")!;
    expect(bugfix.declared).toBe(true);
    expect(bugfix.text).toBe("Fix small defects.");
  });

  it("an unbalanced code fence (forgotten closer) does not swallow the rest of the section's prose (external code review, low/edge-case)", () => {
    const unclosedFence = "## Bugfix / bekannter Defekt\n```\nsome example code\nFix small defects anyway.\n";
    const result = extractBandSections(unclosedFence);
    const bugfix = result.find((b) => b.id === "bugfix")!;
    expect(bugfix.declared).toBe(true);
    expect(bugfix.text).toContain("Fix small defects anyway.");
  });

  it("a BALANCED code fence still hides its contents (regression guard for the unbalanced-fence fix above)", () => {
    const balancedFence = "## Bugfix / bekannter Defekt\nBefore.\n```\nhidden code\n```\nAfter.\n";
    const result = extractBandSections(balancedFence);
    const bugfix = result.find((b) => b.id === "bugfix")!;
    expect(bugfix.text).toBe("Before. After.");
    expect(bugfix.text).not.toContain("hidden code");
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
