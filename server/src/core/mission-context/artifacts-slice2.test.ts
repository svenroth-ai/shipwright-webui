/*
 * artifacts-slice2.test.ts — the TESTS artifact state table (Slice-2 AC1/AC2).
 *
 * The one invariant worth more than the rest: "we could not find out" must
 * never render as "there is nothing". S1's review found exactly this class of
 * bug — an absent-data path that HID an artifact and failed its own AC with no
 * signal — so every unresolvable input below is asserted to reach a VISIBLE
 * `unavailable`, and only a genuine absence is allowed to hide.
 *
 * Review + Decisions live in `artifacts-slice2.review-decisions.test.ts`.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildTestsArtifact } from "./artifacts-slice2.js";
import type { TestsDiff } from "./tests-diff.js";
import { ABSENT, FOUND, NO_INDEX, UNREADABLE, indexWith } from "./slice2-test-fixtures.js";

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

  it("is UNAVAILABLE when the run recorded no commit — the gap is stated, not hidden", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff: { status: "unavailable", reason: "bad_commit" },
      index: NO_INDEX,
    });
    expect(a.state).toBe("unavailable");
    expect(a.note).toMatch(/did not record a commit/i);
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
