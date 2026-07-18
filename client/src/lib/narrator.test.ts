/*
 * narrator.test.ts — pins the deterministic event → plain-language mapping
 * (FR-01.54, A10, campaign webui-wow-usability-2026-07-10). Expected strings
 * are INDEPENDENT literals (never imported from narrator.ts) so a paraphrase
 * flips red, lifted verbatim from the prototype copy-of-record incl. real code
 * points. The two phase RAILS are pinned in narrator-rails.test.ts (split to
 * keep both files <=300 LOC).
 */
import { describe, it, expect } from "vitest";

import {
  narrateVerdict,
  composeVerdict,
  narrateMission,
  narrateRecord,
  type RunFactsLike,
} from "./narrator";

/* ---- Verdict banner (AC1 verbatim) ------------------------------------ */
describe("verdict banner", () => {
  // @covers FR-01.66
  it("renders ALL CLEAR and GATE HOLD verbatim with slots filled", () => {
    const clear = narrateVerdict({ outcome: "clear", tests: { passed: 12, total: 12 } });
    expect(clear.outcome).toBe("clear");
    expect(composeVerdict(clear)).toBe("ALL CLEAR — security · 12/12 tests · review clean");
    const hold = narrateVerdict({
      outcome: "hold",
      detail: "token written to a log line in plain text",
    });
    expect(hold.outcome).toBe("hold");
    expect(composeVerdict(hold)).toBe(
      "GATE HOLD — Security · token written to a log line in plain text — fixing.",
    );
  });
});

/* ---- Mission lines (AC1 verbatim) ------------------------------------- */
describe("mission lines", () => {
  // @covers FR-01.66
  it("emits the complete / hold / designgate lines verbatim", () => {
    expect(
      narrateMission({ state: "complete", changeCount: 1, fileCount: 4, allGreen: true }),
    ).toEqual({ text: "Done.", emphasis: "1 change, 4 files, every check green." });
    expect(narrateMission({ state: "hold" })).toEqual({
      text: "The security gate caught something.",
      emphasis: "The change can’t ship until this is green.",
    });
    expect(narrateMission({ state: "designgate", screenCount: 5 })).toEqual({
      text: "5 screens are ready for your eyes.",
      emphasis: "Nothing gets built until you approve.",
    });
  });

  // @covers FR-01.66
  it("narrates a real zero (strict null check, not falsiness)", () => {
    // 0 is a read value, not "absent" — it must appear, not be dropped.
    expect(
      narrateMission({ state: "complete", changeCount: 0, fileCount: 0 }).emphasis,
    ).toBe("0 changes, 0 files");
    expect(narrateMission({ state: "designgate", screenCount: 0 }).text).toBe(
      "0 screens are ready for your eyes.",
    );
  });
});

/* ---- The Record captions (AC1 verbatim) + receipts -------------------- */
describe("The Record node captions", () => {
  const facts: RunFactsLike = {
    affectedFrs: ["FR-01.28"],
    specImpact: "modify",
    tests: { passed: 2041, total: 2041 },
    gates: { review: "pass" },
    commit: "ac845a1f9c",
  };

  // @covers FR-01.66
  it("emits the 5 nodes with verbatim captions", () => {
    const byKey = Object.fromEntries(narrateRecord(facts).map((n) => [n.key, n]));
    expect(byKey.req.label).toBe("Requirement");
    expect(byKey.req.receipt).toBe("FR-01.28");
    expect(byKey.req.caption).toBe(
      "Everything below must trace to this requirement — or the change does not ship. This is the anchor of the audit trail.",
    );
    expect(byKey.spec.caption).toBe(
      "The written definition of “done”, diffed on this run.",
    );
    expect(byKey.tests.caption).toBe("Suite 2041/2041 green.");
    expect(byKey.tests.receipt).toBe("2041/2041");
    expect(byKey.review.caption).toBe("The verdict that let the change proceed.");
    expect(byKey.review.receipt).toBe("clean");
    expect(byKey.commit.caption).toBe(
      "Spec · changelog · decision log moved in lockstep.",
    );
    expect(byKey.commit.receipt).toBe("ac845a1");
  });
});

/* ---- AC3: honest degradation on a fields-stripped fixture ------------- */
describe("honest degradation (no fabricated numbers/counts/outcomes)", () => {
  const stripped: RunFactsLike = {
    affectedFrs: [],
    specImpact: null,
    tests: null,
    gates: null,
    commit: null,
  };

  /** All narrated strings for a stripped run — used to scan for fabrication. */
  function strippedStrings(): string[] {
    const rec = narrateRecord(stripped);
    const out: string[] = [];
    for (const n of rec) out.push(n.receipt, n.caption);
    out.push(composeVerdict(narrateVerdict({ outcome: "clear", tests: null })));
    out.push(composeVerdict(narrateVerdict({ outcome: "hold", detail: null })));
    const m = narrateMission({ state: "complete" });
    out.push(m.text, m.emphasis);
    const dg = narrateMission({ state: "designgate", screenCount: null });
    out.push(dg.text, dg.emphasis);
    return out;
  }

  // @covers FR-01.66
  it("never emits a digit it did not read", () => {
    for (const s of strippedStrings()) {
      expect(s).not.toMatch(/[0-9]/);
    }
  });

  // @covers FR-01.66
  it("degrades unknown receipts to an explicit n/a", () => {
    const byKey = Object.fromEntries(narrateRecord(stripped).map((n) => [n.key, n]));
    expect(byKey.req.receipt).toBe("n/a");
    expect(byKey.tests.receipt).toBe("n/a");
    expect(byKey.tests.caption).toBe("Suite n/a.");
    expect(byKey.review.receipt).toBe("n/a");
    expect(byKey.commit.receipt).toBe("n/a");
  });

  // @covers FR-01.66
  it("drops the test clause from a clear verdict when tests are unknown", () => {
    expect(composeVerdict(narrateVerdict({ outcome: "clear", tests: null }))).toBe(
      "ALL CLEAR — security · review clean",
    );
  });

  // @covers FR-01.66
  it("drops the security-detail clause from a hold verdict when unknown", () => {
    expect(composeVerdict(narrateVerdict({ outcome: "hold", detail: null }))).toBe(
      "GATE HOLD — Security — fixing.",
    );
  });

  // @covers FR-01.66
  it("complete mission without counts is just Done.", () => {
    expect(narrateMission({ state: "complete" })).toEqual({
      text: "Done.",
      emphasis: "",
    });
  });

  // @covers FR-01.66
  it("designgate without a count omits the number", () => {
    expect(narrateMission({ state: "designgate", screenCount: null })).toEqual({
      text: "Screens are ready for your eyes.",
      emphasis: "Nothing gets built until you approve.",
    });
  });
});
