import { describe, it, expect } from "vitest";

import { isLearningKey, parseLearningLabel } from "./orgLearningLabel";

// Cases ported from leadwright tests/learning-proposal.test.ts (#153, "reading the label back from the logged line"),
// so the window reads a label exactly as the daemon will.
describe("learning label, read as leadwright reads it", () => {
  // @covers FR-01.71
  it("round-trips the label the daemon writes", () => {
    expect(parseLearningLabel("Learning (all leads, importance 5, pinned, replaces learning.x): Rule text.")).toEqual({
      ok: true, labelled: true, label: { scope: "all", importance: 5, pinned: true, replaces: "learning.x", rule: "Rule text." },
    });
  });

  // @covers FR-01.71
  it("honours an operator edit: lower importance, no pinning, any case and spacing", () => {
    expect(parseLearningLabel("learning (All Leads,importance 2):   Rule.")).toMatchObject({ ok: true, label: { scope: "all", importance: 2, pinned: false, rule: "Rule." } });
  });

  // @covers FR-01.71
  it("reads a line without a label as this lead, importance 3", () => {
    expect(parseLearningLabel("Just the rule.")).toEqual({ ok: true, labelled: false, label: { scope: "lead", importance: 3, pinned: false, replaces: undefined, rule: "Just the rule." } });
  });

  // @covers FR-01.71
  it.each([
    ["an unclosed label", "Learning (all leads importance 4 rule"],
    ["an unknown reach", "Learning (everyone): rule"],
    ["an unknown part", "Learning (this lead, urgent): rule"],
    ["a repeated part", "Learning (this lead, importance 2, importance 4): rule"],
    ["a replaced key that is not a learning", "Learning (this lead, replaces weekly): rule"],
    ["an importance out of range", "Learning (this lead, importance 6): rule"],
    ["a replaced key with a character the WebUI cannot record", "Learning (this lead, replaces learning.a/b): rule"],
  ])("refuses %s instead of guessing a reach", (_what, line) => {
    expect(parseLearningLabel(line)).toMatchObject({ ok: false });
  });

  // @covers FR-01.71
  it("names the problem in leadwright's words", () => {
    expect(parseLearningLabel("Learning (everyone): rule")).toEqual({ ok: false, problem: "the label must start with 'this lead' or 'all leads'" });
  });

  // @covers FR-01.71
  it("a learning key needs a name after the prefix", () => {
    expect(isLearningKey("learning.x")).toBe(true);
    expect(isLearningKey("learning.")).toBe(false);
    expect(isLearningKey("weekly-digest")).toBe(false);
  });
});
