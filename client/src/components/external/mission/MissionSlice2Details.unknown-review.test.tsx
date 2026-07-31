/*
 * A review pass this build has never heard of still RENDERS
 * (iterate-2026-07-31-review-record-tolerant-reader).
 *
 * The server used to report a record carrying an unrecognised pass as corrupt,
 * which is why the producer parked its Stage-1 spec-compliance gate in a sibling
 * object nobody reads. Now the row arrives — so the panel has to show it, name it
 * from its own key rather than from a table of guesses, and keep that key
 * available as the row's unambiguous identity.
 *
 * Its own file rather than more cases in `MissionSlice2Details.test.tsx`, which
 * is already past the 300-line rule.
 *
 * @covers FR-01.66
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { ReviewArtifact, ReviewRow } from "../../../lib/missionContextApi";
import { reviewTypeLabel } from "../../../lib/missionArtifacts";

vi.mock("../SmartViewer/DocumentMarkdown", () => ({
  DocumentMarkdown: ({ text }: { text: string }) => <div data-testid="doc-markdown">{text}</div>,
}));

import { ReviewDetail } from "./MissionSlice2Details";

function row(over: Partial<ReviewRow> & Pick<ReviewRow, "reviewType">): ReviewRow {
  return {
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: null,
    parseStatus: null,
    source: "record",
    truncated: false,
    ...over,
  };
}

function artifact(rows: ReviewRow[]): ReviewArtifact {
  return {
    kind: "review",
    label: "Review",
    state: "available",
    summary: null,
    receipt: null,
    detail: { type: "reviews", rows },
  };
}

const PINNED: ReviewRow[] = [
  row({ reviewType: "self", status: "completed", findingsCount: 0 }),
  row({ reviewType: "plan", status: "completed", findingsCount: 3 }),
  row({ reviewType: "code", status: "completed", findingsCount: 1 }),
  row({ reviewType: "doubt", status: "not_run", disposition: "Advisory at this size." }),
  row({ reviewType: "external_code", status: "completed", findingsCount: 2 }),
];

describe("an unrecognised review pass", () => {
  it("gets a row of its own beside the pinned five", () => {
    render(<ReviewDetail artifact={artifact([...PINNED, row({ reviewType: "spec" })])} />);
    expect(screen.getAllByTestId("artifact-review-row")).toHaveLength(6);
  });

  it("is named from its OWN key — never invented, never omitted", () => {
    render(
      <ReviewDetail
        artifact={artifact([
          row({
            reviewType: "spec",
            status: "completed",
            findingsCount: 1,
            findings: [
              { severity: "high", title: "AC3 has no test", location: "a.ts:7", suggestion: null },
            ],
          }),
        ])}
      />,
    );
    const only = screen.getByTestId("artifact-review-row");
    expect(only).toHaveTextContent("Spec review");
    // …and it is a full row, not a placeholder: status word, count and findings.
    expect(screen.getByTestId("artifact-review-status")).toHaveTextContent("ran");
    expect(screen.getByTestId("artifact-review-count")).toHaveTextContent("1 issue");
    expect(screen.getByTestId("artifact-review-location")).toHaveTextContent("a.ts:7");
  });

  it("stays distinguishable ON SCREEN when two keys would prettify alike", () => {
    // `spec` and `spec_` both derive to "Spec review" and HTML collapses the
    // difference. `data-review-type` settles it for a machine and for nobody
    // else — so the VISIBLE text has to carry the key too, or the panel shows
    // two rows with one name and different numbers (external code review,
    // MEDIUM 2). Asserted on rendered text, not on the attribute.
    render(
      <ReviewDetail
        artifact={artifact([row({ reviewType: "spec" }), row({ reviewType: "spec_" })])}
      />,
    );
    const rows = screen.getAllByTestId("artifact-review-row");
    expect(rows[0]).toHaveTextContent("Spec review (spec)");
    expect(rows[1]).toHaveTextContent("Spec review (spec_)");
    // …and the raw key is still on the row for machines.
    expect(rows.map((li) => li.getAttribute("data-review-type"))).toEqual(["spec", "spec_"]);
  });

  it("renders the unknown name as TEXT — never as markup", () => {
    render(<ReviewDetail artifact={artifact([row({ reviewType: "img_onerror" })])} />);
    const only = screen.getByTestId("artifact-review-row");
    expect(only).toHaveTextContent("Img onerror review");
    expect(only.querySelector("img")).toBeNull();
  });
});

describe("reviewTypeLabel derives, it does not guess", () => {
  it.each([
    ["self", "Self-review"],
    ["plan", "Plan review"],
    ["code", "Code review"],
    ["doubt", "Doubt review"],
    ["external_code", "External code review"],
  ])("keeps the curated name for the pinned pass %s", (type, expected) => {
    expect(reviewTypeLabel(type)).toBe(expected);
  });

  it.each([
    ["spec", "Spec review (spec)"],
    ["spec_compliance", "Spec compliance review (spec_compliance)"],
    // Casing is left as the producer wrote it — normalising it would merge
    // distinct passes into one label.
    ["v2_GATE", "V2 GATE review (v2_GATE)"],
    // Hyphens are NOT spaced: only `_` is, so the transformation stays reversible.
    ["pre-flight", "Pre-flight review (pre-flight)"],
  ])("derives %s from the key itself, and shows the key", (type, expected) => {
    expect(reviewTypeLabel(type)).toBe(expected);
  });

  it("does not throw on a row whose type is not a string", () => {
    // `ReviewType` admits any string, so TypeScript no longer stops a malformed
    // row reaching this. Throwing would take the whole Mission panel down over
    // one bad field (external code review, LOW 1).
    expect(() => reviewTypeLabel(undefined as unknown as string)).not.toThrow();
    expect(() => reviewTypeLabel(null as unknown as string)).not.toThrow();
  });
});
