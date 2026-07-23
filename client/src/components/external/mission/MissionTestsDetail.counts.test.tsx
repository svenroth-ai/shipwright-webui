/*
 * MissionTestsDetail.counts.test.tsx — the counts-led TestsDetail render
 * (2026-07-23). Split out of MissionSlice2Details.test.tsx, which is at its
 * bloat baseline and must not ratchet.
 *
 * A worktree run ships `commit:""`, so the Tests detail must LEAD with the
 * recorded pass/total and show no empty file table — the whole point of the
 * counts-led fix.
 *
 * @covers FR-01.66
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { TestsDetail } from "./MissionSlice2Details";
import type { TestsArtifact } from "../../../lib/missionContextApi";

function testsArtifact(over: Partial<NonNullable<TestsArtifact["detail"]>>): TestsArtifact {
  return {
    kind: "tests",
    label: "Tests",
    state: "available",
    summary: null,
    receipt: null,
    detail: {
      type: "tests",
      results: null,
      counts: { added: 1, modified: 0, removed: 0 },
      byLayer: [{ layer: "unit", count: 1 }],
      truncated: false,
      manifestStatus: "ok",
      rows: [{ path: "a.test.ts", kind: "added", layer: "unit", frs: [], caseCount: 1 }],
      ...over,
    },
  };
}

describe("TestsDetail — counts-led", () => {
  it("LEADS with the recorded pass/total and shows no empty table", () => {
    render(<TestsDetail artifact={testsArtifact({ results: { passed: 3037, total: 3037 }, rows: [] })} />);
    expect(screen.getByTestId("artifact-tests-result")).toHaveTextContent("All 3037 tests passing");
    expect(screen.queryByTestId("artifact-tests-table")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifact-tests-no-files")).toBeInTheDocument();
  });

  it("shows BOTH the result headline and the file table when a diff exists", () => {
    render(<TestsDetail artifact={testsArtifact({ results: { passed: 40, total: 42 } })} />);
    expect(screen.getByTestId("artifact-tests-result")).toHaveTextContent("40 of 42 tests passing");
    expect(screen.getByTestId("artifact-tests-table")).toBeInTheDocument();
  });
});
