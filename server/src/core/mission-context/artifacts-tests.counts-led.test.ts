/*
 * artifacts-tests.counts-led.test.ts — the counts-led path (2026-07-23 fix:
 * the Tests artifact LEADS with the recorded pass/total, so the worktree
 * flow's `commit:""` rows show a result instead of an empty card). Split out
 * of artifacts-tests.test.ts, which is at its bloat limit (300 LOC).
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildTestsArtifact } from "./artifacts-tests.js";
import type { EventLookup } from "./iterate-record.js";
import type { TestsDiff } from "./tests-diff.js";
import { FOUND, NO_INDEX } from "./slice2-test-fixtures.js";

/** A completed run that recorded pass/total counts (the common worktree case). */
function foundWithTests(tests: {
  passed: number | null;
  total: number | null;
  skipped?: number | null;
  ts?: string | null;
}): EventLookup {
  if (FOUND.status !== "found") throw new Error("FOUND fixture must be a found lookup");
  const { ts, ...rest } = tests;
  return {
    status: "found",
    mtimeMs: 1,
    run: { ...FOUND.run, ts: ts ?? FOUND.run.ts, tests: { skipped: null, ...rest } },
  };
}

describe("buildTestsArtifact — counts-led (worktree commit:'' rows)", () => {
  it("is AVAILABLE from the recorded counts alone, even with NO commit to diff", () => {
    // The worktree flow's most common shape: real pass/total, empty commit.
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 3037, total: 3037 }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.receipt).toBe("3037/3037 passing");
    expect(a.summary).toMatch(/all 3037 tests passing/i);
    expect(a.detail?.results).toEqual({ passed: 3037, total: 3037, skipped: null, gate: "pass" });
    expect(a.detail?.rows).toEqual([]); // no diff → no per-file rows, and that is fine
  });

  it("shows 'N of M passing' when some failed, and never fabricates a diff", () => {
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 3009, total: 3037 }),
      diff: { status: "unavailable", reason: "git_failed" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.summary).toMatch(/3009 of 3037 tests passing/i);
    expect(a.receipt).toBe("3009/3037 passing");
  });

  it("stays AVAILABLE with counts even when git answered zero test-file changes", () => {
    // Previously not_applicable (hidden). A run that recorded results but touched
    // no test file still has something honest to show.
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 12, total: 12 }),
      diff: { status: "ok", files: [], truncated: false },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.detail?.results).toEqual({ passed: 12, total: 12, skipped: null, gate: "pass" });
  });

  it("LEADS with counts and appends the file clause when a real diff also exists", () => {
    const diff: TestsDiff = {
      status: "ok",
      truncated: false,
      files: [
        { path: "client/src/a.test.ts", kind: "added" },
        { path: "client/src/b.test.ts", kind: "modified" },
        { path: "client/e2e/flows/c.spec.ts", kind: "removed" },
      ],
    };
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 40, total: 42 }),
      diff,
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.receipt).toBe("40/42 passing"); // the headline is the result, not the file count
    expect(a.summary).toMatch(/40 of 42 tests passing/i);
    expect(a.summary).toContain("added 1 test file"); // …then the diff enrichment
    expect(a.detail?.rows).toHaveLength(3);
    expect(a.detail?.results).toEqual({ passed: 40, total: 42, skipped: null, gate: "fail" });
  });

  it("a post-reversal host-gated skip reads genuinely green with the skip disclosed, never a bare 'N of M' indistinguishable from a failure (iterate-2026-08-08-tests-total-skip-contract discriminating case)", () => {
    // passed !== total numerically (9 !== 10), but under the new `total` =
    // collected convention that is a genuine pass — proven by the gate, not
    // the raw counts. "9 of 10 passing" alone would look identical to a real
    // failure, so a genuine skip-carrying pass discloses the skip count
    // instead of rounding up to a now-inaccurate "All 10 passing" (code
    // review, MEDIUM).
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 9, total: 10, skipped: 1, ts: "2026-08-08T12:00:00Z" }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.receipt).toBe("9/10 passing");
    expect(a.summary).toMatch(/9 of 10 tests passing \(1 skipped\)/i);
    expect(a.detail?.results).toEqual({ passed: 9, total: 10, skipped: 1, gate: "pass" });
  });

  it("a post-reversal ALL-skipped run reads as 'skipped — none ran', never as a failure or a false green (doubt review, MEDIUM)", () => {
    // Before this fix "0 of 5 tests passing" read like 5 real failures.
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 0, total: 5, skipped: 5, ts: "2026-08-08T12:00:00Z" }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.detail?.results?.gate).toBe("unknown");
    expect(a.receipt).toBe("5/5 skipped");
    expect(a.summary).toMatch(/all 5 collected tests were skipped — none ran/i);
    expect(a.summary ?? "").not.toMatch(/passing/i);
  });

  it("a MALFORMED unknown record (skipped exceeds total) never claims 'all N were skipped' -- only the raw counts, not a truthy skipped, may license that (external code review, MEDIUM)", () => {
    // total-skip <= 0 -> unknown, but skipped(9) != total(5): the record does
    // not prove every collected test was skipped, just that it is broken.
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 0, total: 5, skipped: 9, ts: "2026-08-08T12:00:00Z" }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.detail?.results?.gate).toBe("unknown");
    expect(a.summary).toBe("No test result recorded.");
    expect(a.summary ?? "").not.toMatch(/all 5/i);
    expect(a.receipt).not.toMatch(/skipped/i);
  });

  it("a MALFORMED unknown record (negative passed) never claims 'all N were skipped' either", () => {
    // passed<0 -> unknown via the earlier passed==null guard; skipped(1) is a
    // genuine positive number but does not prove ALL 5 were skipped.
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: -1, total: 5, skipped: 1, ts: "2026-08-08T12:00:00Z" }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.detail?.results?.gate).toBe("unknown");
    expect(a.summary).toBe("No test result recorded.");
  });

  it("treats {passed:null,total:null} as no counts — an empty tests object is not a result", () => {
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: null, total: null }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable"); // falls through to the honest gap message
  });

  it("says 'N tests recorded' when only a total was recorded", () => {
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: null, total: 42 }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("available");
    expect(a.summary).toMatch(/42 tests recorded/i);
  });

  it("treats {passed:0,total:0} as no counts — never 'All 0 tests passing'", () => {
    const a = buildTestsArtifact({
      events: foundWithTests({ passed: 0, total: 0 }),
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable"); // falls through to the honest gap
    expect(a.summary ?? "").not.toMatch(/all 0 tests/i);
  });
});
