import { describe, expect, it } from "vitest";

import { deriveTestsGate, REVERSAL_EPOCH_MS } from "./tests-gate.js";

const PRE = "2026-08-01T00:00:00Z"; // before the reversal
const POST = "2026-08-08T00:00:01Z"; // after the reversal

describe("deriveTestsGate", () => {
  it("epoch constant lands where the header claims", () => {
    expect(REVERSAL_EPOCH_MS).toBe(Date.parse("2026-08-08T00:00:00Z"));
  });

  describe("pre-reversal (old convention: total = executed only)", () => {
    it("passed === total, no skipped field -> pass (unchanged historical behavior)", () => {
      expect(deriveTestsGate({ passed: 6461, total: 6461 }, PRE)).toBe("pass");
    });

    it("real historical shape: skipped tracked apart from total -> pass", () => {
      expect(deriveTestsGate({ passed: 4390, total: 4390, skipped: 1 }, PRE)).toBe("pass");
    });

    it("passed < total, no skipped -> fail", () => {
      expect(deriveTestsGate({ passed: 6460, total: 6461 }, PRE)).toBe("fail");
    });

    it("THE COLLISION CASE (external review): a genuine failure whose count " +
      "equals skipped must still fail pre-reversal", () => {
      // Old semantics: total=100 executed, passed=99 -> 1 REAL failure;
      // skipped=1 is separately-tracked info, not part of the shortfall.
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, PRE)).toBe("fail");
    });
  });

  describe("post-reversal (new convention: total = collected)", () => {
    it("the SAME numbers as the collision case above read pass post-reversal " +
      "(0 real failures under the new semantics) -- proves the epoch, not the " +
      "raw numbers, disambiguates it", () => {
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, POST)).toBe("pass");
    });

    it("new-convention green: passed + skipped === total", () => {
      expect(deriveTestsGate({ passed: 100, total: 101, skipped: 1 }, POST)).toBe("pass");
    });

    it("new-convention genuine failure with a skip present", () => {
      expect(deriveTestsGate({ passed: 98, total: 100, skipped: 1 }, POST)).toBe("fail");
    });

    it("no skipped field post-reversal behaves like skipped=0", () => {
      expect(deriveTestsGate({ passed: 100, total: 100 }, POST)).toBe("pass");
      expect(deriveTestsGate({ passed: 99, total: 100 }, POST)).toBe("fail");
    });
  });

  describe("defensive input handling (never forge a false pass)", () => {
    it("negative skipped cannot forge a green", () => {
      expect(deriveTestsGate({ passed: 99, total: 98, skipped: -1 }, POST)).toBe("fail");
    });

    it("non-integer skipped is treated as absent (0)", () => {
      expect(deriveTestsGate({ passed: 99, total: 98, skipped: 1.5 }, POST)).toBe("fail");
    });

    it("negative passed -> unknown", () => {
      expect(deriveTestsGate({ passed: -1, total: 10 }, POST)).toBe("unknown");
    });

    it("non-integer total -> unknown", () => {
      expect(deriveTestsGate({ passed: 5, total: 5.5 }, POST)).toBe("unknown");
    });

    it("total <= 0 -> unknown", () => {
      expect(deriveTestsGate({ passed: 0, total: 0 }, POST)).toBe("unknown");
      expect(deriveTestsGate({ passed: 0, total: -5 }, POST)).toBe("unknown");
    });

    it("passed or total null -> unknown", () => {
      expect(deriveTestsGate({ passed: null, total: 10 }, POST)).toBe("unknown");
      expect(deriveTestsGate({ passed: 10, total: null }, POST)).toBe("unknown");
    });

    it("tests object itself null -> unknown", () => {
      expect(deriveTestsGate(null, POST)).toBe("unknown");
    });

    it("post-reversal: every collected test skipped -> unknown, never a vacuous pass " +
      "(code review, MEDIUM: passed+skip===total holds at 0+total===total with " +
      "nothing actually having run)", () => {
      expect(deriveTestsGate({ passed: 0, total: 5, skipped: 5 }, POST)).toBe("unknown");
    });

    it("post-reversal: skip alone exceeding total -> unknown (executed would be negative)", () => {
      expect(deriveTestsGate({ passed: 0, total: 5, skipped: 9 }, POST)).toBe("unknown");
    });
  });

  describe("ts handling", () => {
    it("missing ts defaults to the pre-reversal (stricter) rule", () => {
      // Would read `pass` post-reversal (99+1===100) but `fail` pre-reversal;
      // an absent ts must degrade to the conservative interpretation.
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, null)).toBe("fail");
    });

    it("unparseable ts defaults to the pre-reversal (stricter) rule", () => {
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "not-a-date")).toBe("fail");
    });

    it("ts exactly at the epoch is post-reversal (inclusive boundary)", () => {
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "2026-08-08T00:00:00Z")).toBe("pass");
    });

    it("ts one millisecond before the epoch is pre-reversal", () => {
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "2026-08-07T23:59:59.999Z")).toBe("fail");
    });

    it("an offset-less ts defaults to the pre-reversal rule -- Date.parse would " +
      "otherwise read it as HOST-LOCAL time, making the verdict depend on the " +
      "machine running the check rather than the event itself (doubt review, " +
      "LOW-MEDIUM)", () => {
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "2026-08-08T01:00:00")).toBe("fail");
    });

    it("a non-Z explicit offset (+02:00) still resolves to an instant normally", () => {
      // 2026-08-08T01:00:00+02:00 == 2026-08-07T23:00:00Z -- before the epoch.
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "2026-08-08T01:00:00+02:00")).toBe(
        "fail",
      );
      // 2026-08-08T02:00:00+02:00 == 2026-08-08T00:00:00Z -- at the epoch, post-reversal.
      expect(deriveTestsGate({ passed: 99, total: 100, skipped: 1 }, "2026-08-08T02:00:00+02:00")).toBe(
        "pass",
      );
    });
  });
});
