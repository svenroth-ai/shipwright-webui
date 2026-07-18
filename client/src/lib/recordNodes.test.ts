import { describe, it, expect } from "vitest";

import { deriveRecordNodes } from "./recordNodes";
import type { RunFactsLike } from "./narrator";

/** A fully-green, fully-recorded run. */
const FULL: RunFactsLike = {
  affectedFrs: ["FR-01.55"],
  specImpact: "add",
  tests: { passed: 12, total: 12 },
  gates: { review: "pass" },
  commit: "abc1234deadbeef",
};

function byKey(nodes: ReturnType<typeof deriveRecordNodes>) {
  return Object.fromEntries(nodes.map((n) => [n.key, n]));
}

describe("deriveRecordNodes — honest, state-derived (Fable B3)", () => {
  // @covers FR-01.66
  it("a full run, done → all five nodes done with honest receipts", () => {
    const nodes = deriveRecordNodes({ missionState: "done", facts: FULL });
    expect(nodes.map((n) => n.key)).toEqual(["req", "spec", "tests", "review", "commit"]);
    expect(nodes.every((n) => n.state === "done")).toBe(true);
    const k = byKey(nodes);
    expect(k.req.receipt).toBe("FR-01.55");
    expect(k.spec.receipt).toBe("added");
    expect(k.tests.receipt).toBe("12/12");
    expect(k.review.receipt).toBe("clean");
    expect(k.commit.receipt).toBe("abc1234"); // 7-char sha, never the literal "feat"
  });

  // @covers FR-01.66
  it("mid-run with a FAILING gate → Review is NOT done and shows no 'clean' receipt", () => {
    const nodes = deriveRecordNodes({
      missionState: "live",
      facts: { ...FULL, gates: { review: "fail" }, commit: null },
    });
    const k = byKey(nodes);
    expect(k.review.state).not.toBe("done");
    expect(k.review.state).toBe("now"); // the active frontier while held
    expect(k.review.receipt).not.toBe("clean");
    expect(k.review.receipt).toBe("held");
  });

  // @covers FR-01.66
  it("a run with NO commit → Commit is pending with no receipt (never the literal 'feat')", () => {
    const nodes = deriveRecordNodes({
      missionState: "done",
      facts: { ...FULL, commit: null },
    });
    const k = byKey(nodes);
    expect(k.commit.state).toBe("pending");
    expect(k.commit.receipt).toBeNull();
    expect(nodes.some((n) => n.receipt === "feat")).toBe(false);
  });

  // @covers FR-01.66
  it("design-gate state → still five nodes; the Design step is 'now', nothing downstream done", () => {
    const nodes = deriveRecordNodes({
      missionState: "designgate",
      facts: { affectedFrs: ["FR-01.55"], specImpact: "add" },
    });
    // AC1: EXACTLY five nodes, never a sixth.
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n) => n.key)).toEqual(["req", "spec", "tests", "review", "commit"]);
    const k = byKey(nodes);
    // The spec node is presented as the "Design" step, now (wording from A10).
    expect(k.spec.label).toBe("Design");
    expect(k.spec.state).toBe("now");
    // it does NOT skip ahead to Review — everything after Design is pending
    expect(k.tests.state).toBe("pending");
    expect(k.review.state).toBe("pending");
    expect(k.commit.state).toBe("pending");
    expect(k.review.receipt).toBeNull();
  });

  // @covers FR-01.66
  it("NO run data at all → every node pending, no fabricated receipts", () => {
    const nodes = deriveRecordNodes({ missionState: "done", facts: null });
    expect(nodes).toHaveLength(5);
    expect(nodes.every((n) => n.state === "pending")).toBe(true);
    expect(nodes.every((n) => n.receipt === null)).toBe(true);
  });

  // @covers FR-01.66
  it("tests present but RED → the tests node is not done (stays the live frontier)", () => {
    const nodes = deriveRecordNodes({
      missionState: "live",
      facts: { affectedFrs: ["FR-01.55"], specImpact: "add", tests: { passed: 9, total: 12 } },
    });
    const k = byKey(nodes);
    expect(k.tests.state).toBe("now");
    expect(k.tests.receipt).toBe("9/12"); // honest count, not a green claim
    expect(k.review.state).toBe("pending");
  });
});
