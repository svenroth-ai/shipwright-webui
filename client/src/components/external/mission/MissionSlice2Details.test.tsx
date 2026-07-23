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
      type: "tests", results: null,
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
    parseStatus: null,
    source: "marker",
    truncated: false,
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

  it("renders per-finding rows when a source supplies them", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "plan",
            status: "completed",
            source: "record",
            findingsCount: 1,
            findings: [
              { severity: "HIGH", title: "Unbounded read", location: null, suggestion: null },
            ],
          }),
        ])}
      />,
    );
    const finding = screen.getByTestId("artifact-review-finding");
    expect(finding).toHaveTextContent("HIGH");
    expect(finding).toHaveTextContent("Unbounded read");
    expect(screen.queryByTestId("artifact-review-no-detail")).not.toBeInTheDocument();
  });

  // --- the per-run review record (iterate-2026-07-22-mission-review-record) --

  it("shows where a finding is and what to do about it", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "code",
            status: "completed",
            source: "record",
            findingsCount: 1,
            findings: [
              {
                severity: "medium",
                title: "the lock is released before the write",
                location: "server/src/core/x.ts:42",
                suggestion: "widen the lock",
              },
            ],
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("artifact-review-location")).toHaveTextContent(
      "server/src/core/x.ts:42",
    );
    expect(screen.getByTestId("artifact-review-finding")).toHaveTextContent("widen the lock");
  });

  it("labels the self-review, the only pass that runs on a small change", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({ reviewType: "self", status: "completed", source: "record", findingsCount: 0 }),
        ])}
      />,
    );
    expect(screen.getByTestId("artifact-review-row")).toHaveTextContent("Self-review");
  });

  it("says a pass did not APPLY, rather than that someone skipped it", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "doubt",
            status: "not_applicable",
            source: "record",
            disposition: "docs-only diff; the doubt pass is conditional",
          }),
        ])}
      />,
    );
    const row = screen.getByTestId("artifact-review-row");
    expect(row).toHaveTextContent("did not apply");
    expect(screen.getByTestId("artifact-review-disposition")).toHaveTextContent("docs-only diff");
  });

  it("NEVER shows '0 issues' for a review whose findings could not be itemized", () => {
    // The whole artifact exists to stop a reader completing "0" into "found
    // nothing". A review that ran and could not be parsed is not a clean one.
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "plan",
            status: "completed",
            source: "record",
            parseStatus: "unstructured",
            findingsCount: 0,
          }),
        ])}
      />,
    );
    expect(screen.queryByTestId("artifact-review-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifact-review-unitemized")).toBeInTheDocument();
  });

  it("does not claim missing detail for a record-backed clean review", () => {
    // `findingsCount === findings.length` is guaranteed by the record, so a
    // record-backed zero is a genuine "found nothing" and needs no caveat.
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "code",
            status: "completed",
            source: "record",
            findingsCount: 0,
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("artifact-review-count")).toHaveTextContent("0 issues");
    expect(screen.queryByTestId("artifact-review-no-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-review-unitemized")).not.toBeInTheDocument();
  });

  it("presents a PARTIAL parse as a floor, never as a complete count", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "plan",
            status: "completed",
            source: "record",
            parseStatus: "partial",
            findingsCount: 3,
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("artifact-review-count")).toHaveTextContent("3 issues");
    expect(screen.getByTestId("artifact-review-partial")).toBeInTheDocument();
  });

  it("discloses a capped finding list rather than implying completeness", () => {
    render(
      <ReviewDetail
        artifact={reviewArtifact([
          reviewRow({
            reviewType: "code",
            status: "completed",
            source: "record",
            findingsCount: 200,
            truncated: true,
            findings: [{ severity: null, title: "one of many", location: null, suggestion: null }],
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("artifact-review-truncated")).toBeInTheDocument();
  });
});
