/*
 * Glossary lookup + verbatim-copy guard (A07 / FR-01.50).
 *
 * The whole point of the glossary is "one source, no drift": the framework
 * terms must read WORD-FOR-WORD like the monorepo Plain-Language Index
 * (guide.md Appendix A) and the two prompt glosses must read word-for-word
 * like the approved prototype (Spec/prototype/screens/inbox.js). These tests
 * pin those strings so a well-meaning reword is caught, not merged.
 */
import { describe, it, expect } from "vitest";
import { GLOSSARY, glossaryLookup } from "./glossary";

describe("glossary lookup", () => {
  it("returns the explanation for a known term", () => {
    expect(glossaryLookup("ADR")).toBe(
      "Log of architectural decisions with rationale (why this database, why this pattern)",
    );
  });

  it("is case-insensitive (adr === ADR)", () => {
    expect(glossaryLookup("adr")).toBe(glossaryLookup("ADR"));
    expect(glossaryLookup("Build")).toBe(glossaryLookup("build"));
  });

  it("covers the named requirement/process terms (FR, Spec, Canon)", () => {
    // The spec names these explicitly (IREB, ADR, RTM, SBOM, FR, Spec, Canon, Gate);
    // FR/Spec/Canon are not in the framework plain-language index, so they get
    // honest concise entries rather than being dropped.
    for (const term of ["FR", "Spec", "Canon"]) {
      expect(glossaryLookup(term)).toBeTruthy();
    }
  });

  it("returns undefined for an unknown term (so title renders no attribute)", () => {
    expect(glossaryLookup("not-a-real-term")).toBeUndefined();
    expect(glossaryLookup("")).toBeUndefined();
    expect(glossaryLookup(null)).toBeUndefined();
    expect(glossaryLookup(undefined)).toBeUndefined();
  });
});

describe("glossary: framework terms are VERBATIM from guide.md Appendix A", () => {
  // If any of these fail, the source of truth moved — re-copy from the bank,
  // don't paraphrase here.
  const BANK: Record<string, string> = {
    IREB: "Description of what the app should do, who it's for, and what it must not do",
    Spec: "Description of what the app should do, who it's for, and what it must not do",
    ADR: "Log of architectural decisions with rationale (why this database, why this pattern)",
    RTM: "Coverage matrix where every requirement points at the test that proves it",
    SBOM: "Inventory of every third-party component in the app, for license and CVE tracking",
    "Conventional Commits":
      "Standardized commit-message format (feat:, fix:, etc.) so version history is machine-readable",
    Gate: "A checkpoint between two pipeline steps where output is verified before the next step starts",
    Harness:
      "The whole system of guides (Specs, Conventions) and sensors (Tests, Reviews, Scanners) that steers AI output before and after generation",
  };

  for (const [term, text] of Object.entries(BANK)) {
    it(`"${term}" matches the bank`, () => {
      expect(GLOSSARY[term]).toBe(text);
    });
  }
});

describe("glossary: prompt glosses are VERBATIM from the prototype", () => {
  it("AskUserQuestion matches inbox.js", () => {
    expect(glossaryLookup("AskUserQuestion")).toBe(
      "A mid-run prompt where the pipeline pauses to ask you a multiple-choice question before continuing.",
    );
  });

  it("approval gate matches inbox.js", () => {
    expect(glossaryLookup("approval gate")).toBe(
      "A checkpoint where the pipeline pauses for your approval before it continues.",
    );
  });
});

describe("glossary: every pipeline phase chip has an explanation", () => {
  // The create-dialog phase chips (default-actions.json) are the primary
  // jargon surface this iterate wires a tooltip onto — each must resolve.
  const PHASES = [
    "adopt",
    "project",
    "design",
    "plan",
    "build",
    "test",
    "deploy",
    "changelog",
    "compliance",
    "security",
  ];
  for (const phase of PHASES) {
    it(`phase "${phase}" resolves to a non-empty one-liner`, () => {
      const text = glossaryLookup(phase);
      expect(text).toBeTruthy();
      expect((text ?? "").length).toBeGreaterThan(10);
    });
  }
});
