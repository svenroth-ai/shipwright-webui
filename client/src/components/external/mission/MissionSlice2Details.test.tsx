/*
 * MissionSlice2Details.test.tsx — the Tests · Review · Decisions detail bodies
 * (Slice-2 AC1/AC2/AC4, CONTRACT §7).
 *
 * These cases exist to stop the panel telling a comfortable lie. Specifically:
 *   - a REMOVED test must be visible and labelled as removed (AC2);
 *   - a fold-resolved link must read "mapped from <folded id>" (AC2);
 *   - a missing traceability manifest must read as LINKS UNAVAILABLE, not as a
 *     test that covers nothing;
 *   - a review with no readable record must read as "no record", never as a
 *     pass, and a findings COUNT with no per-finding detail must say so rather
 *     than render an empty list.
 *
 * Decisions moved to `MissionDecisionsDetail.test.tsx` at the 300-LOC rule.
 *
 * @covers FR-01.66
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type {
  ReviewArtifact,
  ReviewRow,
  TestsArtifact,
} from "../../../lib/missionContextApi";

// DocumentMarkdown has its own suite and pulls a large plugin chain; stub it so
// these cases stay about THIS file's structure.
vi.mock("../SmartViewer/DocumentMarkdown", () => ({
  DocumentMarkdown: ({ text }: { text: string }) => <div data-testid="doc-markdown">{text}</div>,
}));

import { ReviewDetail, TestsDetail } from "./MissionSlice2Details";

function testsArtifact(over: Partial<NonNullable<TestsArtifact["detail"]>> = {}): TestsArtifact {
  return {
    kind: "tests",
    label: "Tests",
    state: "available",
    summary: "This change added 1 test file, removed 1 test file.",
    receipt: "2 test files",
    detail: {
      type: "tests",
      counts: { added: 1, modified: 0, removed: 1 },
      byLayer: [{ layer: "unit", count: 1 }],
      truncated: false,
      manifestStatus: "ok",
      rows: [
        {
          path: "client/src/lib/added.test.ts",
          kind: "added",
          layer: "unit",
          frs: [{ frId: "FR-01.28", mappedFrom: "FR-01.44" }],
          caseCount: 3,
        },
        {
          path: "client/e2e/flows/gone.spec.ts",
          kind: "removed",
          layer: "e2e",
          frs: [],
          caseCount: null,
        },
      ],
      ...over,
    },
  };
}

describe("TestsDetail", () => {
  it("renders an RTM table with one row per changed test file", () => {
    render(<TestsDetail artifact={testsArtifact()} />);
    expect(screen.getAllByTestId("artifact-tests-row")).toHaveLength(2);
    expect(screen.getByText("client/src/lib/added.test.ts")).toBeInTheDocument();
  });

  it("shows a REMOVED test, labelled as removed (AC2)", () => {
    render(<TestsDetail artifact={testsArtifact()} />);
    const removed = screen
      .getAllByTestId("artifact-tests-row")
      .find((r) => r.getAttribute("data-kind") === "removed");
    expect(removed).toBeDefined();
    expect(removed!).toHaveTextContent("client/e2e/flows/gone.spec.ts");
    expect(removed!).toHaveTextContent("removed");
  });

  it("renders the fold provenance as 'mapped from <folded id>' (AC2)", () => {
    render(<TestsDetail artifact={testsArtifact()} />);
    expect(screen.getByTestId("artifact-tests-fr")).toHaveTextContent(
      "FR-01.28 (mapped from FR-01.44)",
    );
  });

  it("does NOT invent a 'mapped from' badge when no fold applied", () => {
    render(
      <TestsDetail
        artifact={testsArtifact({
          rows: [
            {
              path: "a.test.ts",
              kind: "modified",
              layer: "unit",
              frs: [{ frId: "FR-01.28", mappedFrom: null }],
              caseCount: 1,
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("artifact-tests-fr")).toHaveTextContent("FR-01.28");
    expect(screen.queryByText(/mapped from/)).not.toBeInTheDocument();
  });

  it("translates the layer instead of leaking `e2e` jargon", () => {
    render(<TestsDetail artifact={testsArtifact()} />);
    expect(screen.getByText("end-to-end")).toBeInTheDocument();
  });

  it("says LINKS UNAVAILABLE when the manifest could not be read", () => {
    render(<TestsDetail artifact={testsArtifact({ manifestStatus: "unavailable" })} />);
    expect(screen.getByTestId("artifact-tests-links-unavailable")).toBeInTheDocument();
    // The rows are still real — a missing manifest costs links, not tests.
    expect(screen.getAllByTestId("artifact-tests-row")).toHaveLength(2);
  });

  it("stays silent about links when the manifest WAS read", () => {
    render(<TestsDetail artifact={testsArtifact()} />);
    expect(screen.queryByTestId("artifact-tests-links-unavailable")).not.toBeInTheDocument();
  });

  it("discloses truncation so a capped table never implies completeness", () => {
    render(<TestsDetail artifact={testsArtifact({ truncated: true })} />);
    expect(screen.getByTestId("artifact-tests-truncated")).toBeInTheDocument();
  });
});

function reviewRow(over: Partial<ReviewRow> & Pick<ReviewRow, "reviewType">): ReviewRow {
  return {
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: null,
    ...over,
  };
}

function reviewArtifact(rows: ReviewRow[]): ReviewArtifact {
  return {
    kind: "review",
    label: "Review",
    state: "available",
    summary: "…",
    receipt: "…",
    detail: { type: "reviews", rows },
  };
}

describe("ReviewDetail", () => {
  const FOUR = [
    reviewRow({ reviewType: "plan", status: "completed", findingsCount: 8 }),
    reviewRow({ reviewType: "code", note: "no machine-readable record" }),
    reviewRow({ reviewType: "doubt", note: "no machine-readable record" }),
    reviewRow({ reviewType: "external_code", status: "not_run", note: "Not run — user opt out." }),
  ];

  it("renders ALL FOUR review types, in contract order (AC4)", () => {
    render(<ReviewDetail artifact={reviewArtifact(FOUR)} />);
    expect(
      screen.getAllByTestId("artifact-review-row").map((r) => r.getAttribute("data-review-type")),
    ).toEqual(["plan", "code", "doubt", "external_code"]);
  });

  it("renders an unreadable pass as 'no record' — NEVER as passed or clean", () => {
    render(<ReviewDetail artifact={reviewArtifact(FOUR)} />);
    const code = screen
      .getAllByTestId("artifact-review-row")
      .find((r) => r.getAttribute("data-review-type") === "code")!;
    expect(code).toHaveTextContent("no record");
    for (const word of [/passed/i, /clean/i, /no issues/i, /0 issues/i]) {
      expect(code.textContent).not.toMatch(word);
    }
  });

  it("distinguishes 'not run' from 'no record'", () => {
    render(<ReviewDetail artifact={reviewArtifact(FOUR)} />);
    const ext = screen
      .getAllByTestId("artifact-review-row")
      .find((r) => r.getAttribute("data-review-type") === "external_code")!;
    expect(ext).toHaveTextContent("not run");
    expect(ext).toHaveTextContent("user opt out");
  });

  it("shows the real findings count and admits the details are not recorded", () => {
    render(<ReviewDetail artifact={reviewArtifact(FOUR)} />);
    expect(screen.getByTestId("artifact-review-count")).toHaveTextContent("8 issues");
    expect(screen.getByTestId("artifact-review-no-detail")).toBeInTheDocument();
  });

  it("does not claim missing detail for a review that found nothing", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([reviewRow({ reviewType: "plan", status: "completed", findingsCount: 0 })])}
      />,
    );
    expect(screen.getByTestId("artifact-review-count")).toHaveTextContent("0 issues");
    expect(screen.queryByTestId("artifact-review-no-detail")).not.toBeInTheDocument();
  });

  it("renders per-finding rows when a source ever supplies them", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "plan",
            status: "completed",
            findingsCount: 1,
            findings: [{ severity: "HIGH", title: "Unbounded read" }],
          }),
        ])}
      />,
    );
    expect(screen.getByText("HIGH — Unbounded read")).toBeInTheDocument();
    expect(screen.queryByTestId("artifact-review-no-detail")).not.toBeInTheDocument();
  });
});
