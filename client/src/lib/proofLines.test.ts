import { describe, it, expect } from "vitest";

import {
  deriveProofLines,
  deriveVerdict,
  sanitizeProofText,
  type ProofFacts,
  type ProofLine,
} from "./proofLines";

/** Flatten a proof line's spans to its visible text. */
function lineText(line: ProofLine): string {
  return line.spans.map((s) => s.text).join("");
}
function allText(lines: ProofLine[]): string {
  return lines.map(lineText).join("\n");
}

const GREEN: ProofFacts = {
  runId: "iterate-2026-07-10-x",
  commit: "ac845a1def",
  affectedFrs: ["FR-01.56"],
  tests: { passed: 1882, total: 1882 },
  gates: { test: "pass", review: "pass", security: "pass" },
};

const HOLD: ProofFacts = {
  runId: "iterate-2026-07-10-x",
  commit: null,
  affectedFrs: ["FR-01.56"],
  tests: { passed: 10, total: 12 },
  gates: { test: "unknown", review: "unknown", security: "fail" },
};

describe("deriveVerdict", () => {
  // @covers FR-01.66
  it("no facts -> neutral, NEVER a false ALL CLEAR (AC3)", () => {
    expect(deriveVerdict({ facts: null })).toEqual({ outcome: "neutral", heldGate: null });
  });

  // @covers FR-01.66
  it("empty event log (facts present but no evidence) -> NOT clear (AC3)", () => {
    const v = deriveVerdict({ facts: { tests: null, gates: null } });
    expect(v.outcome).toBe("neutral");
    expect(v.outcome).not.toBe("clear");
  });

  // @covers FR-01.66
  it("suite green + review clean + no failing gate -> clear", () => {
    expect(deriveVerdict({ facts: GREEN })).toEqual({ outcome: "clear", heldGate: null });
  });

  // @covers FR-01.66
  it("a real failing security gate -> hold (names the held gate)", () => {
    expect(deriveVerdict({ facts: HOLD })).toEqual({ outcome: "hold", heldGate: "security" });
  });

  // @covers FR-01.66
  it("a hold WINS even when the suite happens to be green (never a false clear)", () => {
    const v = deriveVerdict({
      facts: { tests: { passed: 5, total: 5 }, gates: { review: "pass", security: "fail" } },
    });
    expect(v.outcome).toBe("hold");
  });

  // @covers FR-01.66
  it("suite still red (passed < total) -> neutral, not clear", () => {
    const v = deriveVerdict({
      facts: { tests: { passed: 8, total: 12 }, gates: { review: "pass", security: "pass" } },
    });
    expect(v.outcome).toBe("neutral");
  });

  // @covers FR-01.66
  it("review not yet clean -> neutral, not clear", () => {
    const v = deriveVerdict({
      facts: { tests: { passed: 12, total: 12 }, gates: { review: "unknown", security: "pass" } },
    });
    expect(v.outcome).toBe("neutral");
  });

  // @covers FR-01.66
  it("an UNKNOWN security gate is not clear — ALL CLEAR needs affirmative evidence (AC5)", () => {
    // Today's real state: the server never emits a review/security signal, so both
    // are `unknown`. A green suite with unwired gates must NOT read ALL CLEAR.
    const v = deriveVerdict({
      facts: { tests: { passed: 12, total: 12 }, gates: { review: "unknown", security: "unknown" } },
    });
    expect(v.outcome).toBe("neutral");
  });

  // @covers FR-01.66
  it("review pass but security unknown -> still neutral (both gates must be pass)", () => {
    const v = deriveVerdict({
      facts: { tests: { passed: 12, total: 12 }, gates: { review: "pass", security: "unknown" } },
    });
    expect(v.outcome).toBe("neutral");
  });

  // @covers FR-01.66
  it("zero-total suite is not 'green' (guards a vacuous ALL CLEAR)", () => {
    const v = deriveVerdict({
      facts: { tests: { passed: 0, total: 0 }, gates: { review: "pass", security: "pass" } },
    });
    expect(v.outcome).toBe("neutral");
  });
});

describe("deriveProofLines", () => {
  // @covers FR-01.66
  it("green run -> prompt + suite pass + checks + commit with its FR", () => {
    const verdict = deriveVerdict({ facts: GREEN });
    const lines = deriveProofLines({ facts: GREEN, verdict });
    const text = allText(lines);
    expect(text).toContain("iterate-2026-07-10-x");
    expect(text).toContain("suite green");
    expect(text).toContain("1882 passed");
    expect(text).toContain("review clean");
    expect(text).toContain("security clean");
    expect(text).toContain("committed");
    expect(text).toContain("[FR-01.56]");
    expect(lines.length).toBeLessThanOrEqual(8);
  });

  // @covers FR-01.66
  it("a red suite is SURFACED honestly (not hidden) on a neutral run", () => {
    const facts: ProofFacts = {
      runId: "iterate-2026-07-10-x",
      tests: { passed: 8, total: 12 },
      gates: { test: "fail", review: "unknown", security: "unknown" },
    };
    const verdict = deriveVerdict({ facts });
    expect(verdict.outcome).toBe("neutral"); // a red test gate is not a security hold
    const text = allText(deriveProofLines({ facts, verdict }));
    expect(text).toContain("suite"); // the failure is shown
    expect(text).toContain("8/12 passing");
    expect(text).not.toContain("suite green");
  });

  // @covers FR-01.66
  it("gate-hold run -> the failing gate named, and NO ✓ pass line beside it", () => {
    const verdict = deriveVerdict({ facts: HOLD });
    const lines = deriveProofLines({ facts: HOLD, verdict });
    const text = allText(lines);
    expect(text).toContain("security gate held");
    // Fable B3: a HOLD verdict never sits beside a "clean" receipt.
    expect(text).not.toContain("review clean");
    expect(text).not.toContain("security clean");
    expect(text).not.toContain("suite green");
  });

  // @covers FR-01.66
  it("empty log -> empty summary (never an invented line, AC5)", () => {
    const verdict = deriveVerdict({ facts: null });
    expect(deriveProofLines({ facts: null, verdict })).toEqual([]);
  });

  // @covers FR-01.66
  it("durations ALWAYS render n/a — never synthesized (AC4)", () => {
    const verdict = deriveVerdict({ facts: GREEN });
    const lines = deriveProofLines({ facts: GREEN, verdict });
    const prompt = lines.find((l) => l.id === "prompt")!;
    // The trailing dim span is the duration slot; it is a constant n/a.
    const durationSpan = prompt.spans[prompt.spans.length - 1];
    expect(durationSpan.kind).toBe("d");
    expect(durationSpan.text).toContain("n/a");
    // NEVER a fabricated/formatted number.
    expect(durationSpan.text).not.toMatch(/\d/);
  });

  // @covers FR-01.66
  it("neutral run with only a runId -> just the honest prompt line", () => {
    const facts: ProofFacts = { runId: "iterate-2026-07-10-y", tests: null, gates: null };
    const verdict = deriveVerdict({ facts });
    const lines = deriveProofLines({ facts, verdict });
    expect(lines.map((l) => l.id)).toEqual(["prompt"]);
  });

  // @covers FR-01.66
  it("commit without an FR still renders (no fabricated bracket)", () => {
    const facts: ProofFacts = { ...GREEN, affectedFrs: [] };
    const verdict = deriveVerdict({ facts });
    const commit = deriveProofLines({ facts, verdict }).find((l) => l.id === "commit")!;
    expect(lineText(commit)).toContain("committed");
    expect(lineText(commit)).not.toContain("[");
  });

  // @covers FR-01.66
  it("strips control + bidi characters from event-log-derived text (touches_io_boundary)", () => {
    const facts: ProofFacts = {
      // a runId carrying a CR, a NUL, and a bidi override — all must be stripped.
      runId: `iterate${String.fromCodePoint(0x0d)}-2026${String.fromCodePoint(0x202e)}-evil`,
      tests: null,
      gates: null,
    };
    const verdict = deriveVerdict({ facts });
    const prompt = deriveProofLines({ facts, verdict }).find((l) => l.id === "prompt")!;
    const text = lineText(prompt);
    const hasBadChar = [...text].some((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x202a && cp <= 0x202e);
    });
    expect(hasBadChar).toBe(false);
    expect(text).toContain("iterate-2026-evil");
  });
});

describe("sanitizeProofText", () => {
  // @covers FR-01.66
  it("removes C0/C1 controls, DEL and bidi overrides; collapses whitespace", () => {
    const dirty = `a${String.fromCodePoint(0x09)}b${String.fromCodePoint(0x0d)}${String.fromCodePoint(0x0a)}  c${String.fromCodePoint(0x202e)}d`;
    expect(sanitizeProofText(dirty)).toBe("ab cd");
  });

  // @covers FR-01.66
  it("caps length with an ellipsis", () => {
    const out = sanitizeProofText("x".repeat(200), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith(String.fromCodePoint(0x2026))).toBe(true);
  });

  // @covers FR-01.66
  it("leaves ordinary run ids untouched", () => {
    expect(sanitizeProofText("iterate-2026-07-10-missionview-operation")).toBe(
      "iterate-2026-07-10-missionview-operation",
    );
  });
});
