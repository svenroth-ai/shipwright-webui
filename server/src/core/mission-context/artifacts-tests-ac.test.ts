/*
 * artifacts-tests-ac.test.ts — the per-AC regrouping of the Tests artifact's
 * rows (split from artifacts-tests.test.ts at the 300-LOC rule).
 *
 * The one invariant this file exists to pin: `tagged: false` (no row's
 * manifest link carries an `ac_id`) is the DEFAULT, not a corner case —
 * measured in this repo, 0 of 33 requirements carry `ac_id` today. A view
 * that defaults to "tagged" would misreport the common case as coverage.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { buildTestsArtifact } from "./artifacts-tests.js";
import type { TestsDiff } from "./tests-diff.js";
import { FOUND, indexWith, NO_INDEX } from "./slice2-test-fixtures.js";

const diff: TestsDiff = {
  status: "ok",
  truncated: false,
  files: [
    { path: "client/src/a.test.ts", kind: "added" },
    { path: "client/src/b.test.ts", kind: "modified" },
    { path: "client/e2e/flows/c.spec.ts", kind: "removed" },
  ],
};

describe("buildTestsArtifact — acCoverage (a view, no new binding)", () => {
  it("defaults to untagged when no manifest link carries an ac_id — the real-repo shape", () => {
    const a = buildTestsArtifact({ events: FOUND, diff, index: NO_INDEX });
    expect(a.detail?.acCoverage).toEqual({ tagged: false, groups: [] });
  });

  it("groups a tagged row under its (frId, acId)", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff,
      index: indexWith({
        "client/src/b.test.ts": {
          layers: ["unit"],
          frs: [{ frId: "FR-01.11", mappedFrom: null, acIds: ["AC07"] }],
        },
      }),
    });
    expect(a.detail?.acCoverage).toEqual({
      tagged: true,
      groups: [{ frId: "FR-01.11", acId: "AC07", files: [{ path: "client/src/b.test.ts", kind: "modified" }] }],
    });
  });

  it("puts one file under EACH of its AC ids when it carries more than one", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff,
      index: indexWith({
        "client/src/b.test.ts": {
          layers: ["unit"],
          frs: [{ frId: "FR-01.11", mappedFrom: null, acIds: ["AC07", "AC09"] }],
        },
      }),
    });
    expect(a.detail?.acCoverage.groups.map((g) => g.acId).sort()).toEqual(["AC07", "AC09"]);
  });

  it("does not cross-contaminate: an untagged FR on one file stays out of a tagged group on another", () => {
    const a = buildTestsArtifact({
      events: FOUND,
      diff,
      index: indexWith({
        "client/src/a.test.ts": {
          layers: ["unit"],
          frs: [{ frId: "FR-01.10", mappedFrom: null, acIds: [] }],
        },
        "client/src/b.test.ts": {
          layers: ["unit"],
          frs: [{ frId: "FR-01.11", mappedFrom: null, acIds: ["AC07"] }],
        },
      }),
    });
    expect(a.detail?.acCoverage.tagged).toBe(true);
    expect(a.detail?.acCoverage.groups).toHaveLength(1);
    expect(a.detail?.acCoverage.groups[0].files).toEqual([{ path: "client/src/b.test.ts", kind: "modified" }]);
  });
});
