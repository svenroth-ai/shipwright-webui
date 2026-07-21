/*
 * narrator-prose.test.ts — the wording layer (FR-01.68 AC1/AC3/AC5/AC6/AC7).
 *
 * These tests are mostly about restraint: what the card may NOT say. The
 * evidence tiers exist because `is_error` alone does not prove "six failed",
 * and the no-durations rule exists because elapsed wall-clock measures thinking
 * time, not work.
 */

import { describe, it, expect } from "vitest";

import type { NarrativeFacts } from "./narrator-facts";
import { narrate, type Paragraph } from "./narrator-prose";

const base: NarrativeFacts = {
  ask: null,
  read: 0,
  searched: 0,
  changed: 0,
  commands: 0,
  specWritten: false,
  tests: [],
  commits: 0,
  pushed: false,
  pr: null,
  pending: false,
};

const facts = (over: Partial<NarrativeFacts>): NarrativeFacts => ({ ...base, ...over });
const text = (paras: Paragraph[]) =>
  paras.map((p) => p.map((s) => s.text).join("")).join("\n\n");
const links = (paras: Paragraph[]) =>
  paras.flatMap((p) => p.filter((s) => s.kind === "link"));

const ALL = ["spec", "tests", "commit", "requirement", "review", "decisions"];

describe("prose, not a list (AC1)", () => {
  it("tells the arc of a real run in sentences", () => {
    const out = text(
      narrate(
        facts({
          ask: "Make the New button match the others",
          read: 5,
          searched: 2,
          changed: 12,
          tests: [
            { status: "failed", failed: 6 },
            { status: "passed", counted: true },
          ],
          commits: 1,
          pr: 307,
        }),
        ALL,
      ),
    );
    expect(out).toContain("You asked: “Make the New button match the others”");
    expect(out).toContain("five files read and two searches through the code");
    expect(out).toContain("Twelve files were then changed");
    expect(out).toContain("six of them failed");
    expect(out).toContain("came back green");
    expect(out).toContain("pull request #307");
  });

  it("says nothing at all when the transcript evidences nothing (AC7)", () => {
    expect(narrate(base, ALL)).toEqual([]);
  });

  it("omits, rather than placeholders, the parts that did not happen", () => {
    expect(text(narrate(facts({ changed: 1 }), ALL))).toBe("One file was then changed.");
  });

  // Singular/plural agreement is not cosmetic here: this card exists so a
  // non-developer can read it, and "One file were changed" reads as broken.
  it("agrees in number", () => {
    expect(text(narrate(facts({ changed: 2 }), ALL))).toBe("Two files were then changed.");
    expect(text(narrate(facts({ read: 1 }), ALL))).toContain("one file read");
    expect(text(narrate(facts({ searched: 1 }), ALL))).toContain("one search through the code");
    expect(text(narrate(facts({ tests: [{ status: "failed", failed: 1 }] }), ALL))).toContain(
      "one of them is still failing",
    );
    expect(text(narrate(facts({ tests: [{ status: "failed", failed: 2 }] }), ALL))).toContain(
      "two of them are still failing",
    );
  });

  it("spaces its words — a link is a span boundary, not a word boundary", () => {
    const out = text(narrate(facts({ tests: [{ status: "passed", counted: true }] }), ALL));
    expect(out).toBe("The tests were run and the whole suite passed.");
    expect(out).not.toMatch(/\w{2,}\s{2,}|testswere|filewas/);
  });
});

describe("no durations, ever (AC6)", () => {
  it("never emits a time unit", () => {
    const out = text(
      narrate(
        facts({
          ask: "x y z",
          read: 9,
          changed: 3,
          tests: [{ status: "failed", failed: 2 }, { status: "passed", counted: true }],
          commits: 1,
          pr: 1,
        }),
        ALL,
      ),
    );
    expect(out).not.toMatch(/\b(minute|minutes|hour|hours|second|seconds|ago|elapsed)\b/i);
  });
});

describe("evidence tiers — the card never outruns its proof (AC3)", () => {
  it("an is_error without a count does not invent one", () => {
    const out = text(narrate(facts({ tests: [{ status: "failed", failed: null }] }), ALL));
    expect(out).toContain("were run and did not pass");
    expect(out).not.toMatch(/\d/);
  });

  it("a COUNTED pass may claim the whole suite; an uncounted one may not", () => {
    const counted = text(narrate(facts({ tests: [{ status: "passed", counted: true }] }), ALL));
    expect(counted).toContain("the whole suite passed");

    const quiet = text(narrate(facts({ tests: [{ status: "passed", counted: false }] }), ALL));
    expect(quiet).toContain("completed without errors");
    expect(quiet).not.toContain("whole suite");
  });

  /*
   * WHOLE-SENTENCE assertion, on purpose. The fragment checks above passed
   * while the shipped string read "The tests, and three of them failed." — the
   * verb was missing and only a real-transcript render caught it. A `toContain`
   * on a fragment cannot see a hole beside the fragment.
   */
  it("reads as a complete sentence, not a fragment that happens to contain the words", () => {
    expect(
      text(
        narrate(
          facts({ tests: [{ status: "failed", failed: 3 }, { status: "passed", counted: true }] }),
          ALL,
        ),
      ),
    ).toBe(
      "The tests were run, and three of them failed. " +
        "Work continued until the whole suite came back green.",
    );
    expect(text(narrate(facts({ tests: [{ status: "pending" }] }), ALL))).toBe(
      "The tests are running now.",
    );
    expect(text(narrate(facts({ tests: [{ status: "failed", failed: null }] }), ALL))).toBe(
      "The tests were run and did not pass.",
    );
  });

  it("recovery after failure is graded the same way", () => {
    const strong = text(
      narrate(
        facts({ tests: [{ status: "failed", failed: 3 }, { status: "passed", counted: true }] }),
        ALL,
      ),
    );
    expect(strong).toContain("three of them failed");
    expect(strong).toContain("until the whole suite came back green");

    const weak = text(
      narrate(
        facts({ tests: [{ status: "failed", failed: 3 }, { status: "passed", counted: false }] }),
        ALL,
      ),
    );
    expect(weak).toContain("until a later run completed without errors");
    expect(weak).not.toContain("green");
  });

  it("still-failing says so, and never claims recovery", () => {
    const out = text(
      narrate(
        facts({ tests: [{ status: "passed", counted: true }, { status: "failed", failed: 1 }] }),
        ALL,
      ),
    );
    expect(out).toContain("one of them is still failing");
    expect(out).not.toContain("green");
  });

  it("a pending run is running, not passing (AC3b)", () => {
    const out = text(narrate(facts({ tests: [{ status: "pending" }] }), ALL));
    expect(out).toContain("are running now");
    expect(out).not.toMatch(/passed|failed|green/);
  });
});

describe("inline links resolve or become plain text (AC5)", () => {
  it("links the nouns the rail actually offers", () => {
    const out = links(narrate(facts({ specWritten: true, tests: [], commits: 1 }), ALL));
    expect(out.map((s) => s.text)).toEqual(["plan", "recorded"]);
    expect(out.map((s) => (s.kind === "link" ? s.artifact : null))).toEqual(["spec", "commit"]);
  });

  it("emits NO link when the rail has no such node — same words, no dead button", () => {
    const paras = narrate(facts({ specWritten: true, commits: 1 }), []);
    expect(links(paras)).toEqual([]);
    expect(text(paras)).toContain("The plan was written down");
    expect(text(paras)).toContain("The change was recorded");
  });

  it("never links the pull request — it is not a rail node", () => {
    const paras = narrate(facts({ commits: 1, pr: 42 }), ALL);
    expect(links(paras).map((s) => s.text)).toEqual(["recorded"]);
    expect(text(paras)).toContain("pull request #42");
  });
});
