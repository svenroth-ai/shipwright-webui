/*
 * artifacts-tests.test.ts — the TESTS artifact state table (Slice-2 AC1/AC2 +
 * the 2026-07-23 counts-led rule).
 *
 * The one invariant worth more than the rest: "we could not find out" must
 * never render as "there is nothing". S1's review found exactly this class of
 * bug — an absent-data path that HID an artifact and failed its own AC with no
 * signal — so every unresolvable input below is asserted to reach a VISIBLE
 * `unavailable`, and only a genuine absence is allowed to hide.
 *
 * The counts-led block pins the 2026-07-23 fix: the artifact LEADS with the
 * pass/total the run recorded, so the worktree flow's `commit:""` rows (which
 * can never produce a diff) show their result instead of an empty card.
 *
 * Review + Decisions live in `artifacts-slice2.review-decisions.test.ts`.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildTestsArtifact } from "./artifacts-tests.js";
import type { EventLookup } from "./iterate-record.js";
import type { TestsDiff } from "./tests-diff.js";
import { ABSENT, FOUND, NO_INDEX, UNREADABLE, indexWith } from "./slice2-test-fixtures.js";

/** A completed run that recorded pass/total counts (the common worktree case). */
function foundWithTests(tests: { passed: number | null; total: number | null }): EventLookup {
  if (FOUND.status !== "found") throw new Error("FOUND fixture must be a found lookup");
  return { status: "found", mtimeMs: 1, run: { ...FOUND.run, tests } };
}

describe("buildTestsArtifact — the never-a-false-negative rule", () => {
  it("is UNAVAILABLE (visible) when git could not answer — never 'no tests'", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff: { status: "unavailable", reason: "git_failed" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable");
    expect(a.note).toBeTruthy();
    expect(a.detail).toBeNull();
  });

  it("is UNAVAILABLE when the run recorded NO counts AND no commit — the gap is stated, not hidden", () => {
    const a = buildTestsArtifact({
      events: FOUND, // FOUND.tests === null
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable");
    expect(a.note).toMatch(/no commit/i);
  });

  it("is UNAVAILABLE when the run record itself could not be read", () => {
    const a = buildTestsArtifact({
      events: UNREADABLE,
      diff: { status: "ok", files: [], truncated: false },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable");
  });

  it("is NOT_YET_CREATED (hidden) mid-run — expected later, not a fault", () => {
    const a = buildTestsArtifact({
      events: ABSENT,
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("not_yet_created");
  });

  it("is NOT_APPLICABLE (hidden) only when git ANSWERED and no test file moved", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff: { status: "ok", files: [], truncated: false },
      index: NO_INDEX,
    });
    expect(a.state).toBe("not_applicable");
  });
});

describe("buildTestsArtifact — rows and classification", () => {
  const diff: TestsDiff = {
    status: "ok",
    truncated: false,
    files: [
      { path: "client/src/a.test.ts", kind: "added" },
      { path: "client/src/b.test.ts", kind: "modified" },
      { path: "client/e2e/flows/c.spec.ts", kind: "removed" },
    ],
  };

  it("classifies added / modified / REMOVED and counts them (AC2)", () => {
    const a = buildTestsArtifact({ events: FOUND, diff, index: NO_INDEX });
    expect(a.state).toBe("available");
    expect(a.detail?.counts).toEqual({ added: 1, modified: 1, removed: 1 });
    expect(a.detail?.rows.find((r) => r.path.endsWith("c.spec.ts"))?.kind).toBe("removed");
  });

  it("carries fold provenance onto the row so the UI can say 'mapped from' (AC2)", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff,
      index: indexWith({
        "client/src/b.test.ts": {
          layers: ["unit"],
          frs: [{ frId: "FR-01.28", mappedFrom: "FR-01.44" }],
        },
      }),
    });
    const row = a.detail!.rows.find((r) => r.path === "client/src/b.test.ts")!;
    expect(row.frs).toEqual([{ frId: "FR-01.28", mappedFrom: "FR-01.44" }]);
    expect(row.layer).toBe("unit");
  });

  it("INFERS the layer of a removed file, whose manifest entry is gone by definition", () => {
    const a = buildTestsArtifact({ events: FOUND, diff, index: NO_INDEX });
    const removed = a.detail!.rows.find((r) => r.kind === "removed")!;
    expect(removed.layer).toBe("e2e");
    expect(removed.frs).toEqual([]);
  });

  it("flags manifestStatus so missing FR links read as MISSING, not as 'covers nothing'", () => {
    const withManifest = buildTestsArtifact({ events: FOUND, diff, index: indexWith({}) });
    const without = buildTestsArtifact({ events: FOUND, diff, index: NO_INDEX });
    expect(withManifest.detail?.manifestStatus).toBe("ok");
    expect(without.detail?.manifestStatus).toBe("unavailable");
    // The rows are real either way — losing the manifest loses links, not tests.
    expect(without.detail?.rows).toHaveLength(3);
  });

  it("treats a PARTIAL manifest index as unavailable links, not as fine", () => {
    // External code review, MEDIUM: hitting the entry cap returns `ok` with a
    // partial map. A file whose entry fell past the cap would render "covers
    // nothing" while the UI claimed the manifest was healthy — a false negative
    // dressed as a clean answer.
    const partial = { ...indexWith({}), truncated: true } as const;
    const a = buildTestsArtifact({ events: FOUND, diff, index: partial });
    expect(a.detail?.manifestStatus).toBe("unavailable");
    // The rows themselves stay real.
    expect(a.detail?.rows).toHaveLength(3);
  });

  it("aggregates per layer and writes a summary a non-expert can read", () => {
    const a = buildTestsArtifact({ events: FOUND, diff, index: NO_INDEX });
    expect(a.detail?.byLayer).toEqual([
      { layer: "unit", count: 2 },
      { layer: "e2e", count: 1 },
    ]);
    expect(a.summary).toContain("added 1 test file");
    expect(a.summary).toContain("removed 1 test file");
    expect(a.summary).toContain("end-to-end");
    // Jargon must not leak into the rail.
    expect(a.summary).not.toContain("e2e");
  });

  it("propagates truncation so a capped list never implies completeness", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff: { ...diff, truncated: true },
      index: NO_INDEX,
    });
    expect(a.detail?.truncated).toBe(true);
  });
});

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
    expect(a.detail?.results).toEqual({ passed: 3037, total: 3037 });
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
    expect(a.detail?.results).toEqual({ passed: 12, total: 12 });
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
    expect(a.detail?.results).toEqual({ passed: 40, total: 42 });
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
