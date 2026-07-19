/*
 * MissionDecisionsDetail.test.tsx — the Decisions detail body (CONTRACT §6 row 5).
 *
 * Split from `MissionSlice2Details.test.tsx` at the 300-LOC rule, mirroring the
 * server-side split of `artifacts-decisions.ts` out of `artifacts-slice2.ts`.
 *
 * What these cases hold in place: a decision recorded at an iterate's F3 has NO
 * ADR number until a release aggregates it, and that is the ordinary state of
 * every unmerged run — not an error. It must therefore render as real and
 * recorded, visibly distinct from a numbered ADR, with no number invented to
 * fill the gap and no wording that suggests something went wrong.
 *
 * @covers FR-01.66
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { DecisionsArtifact } from "../../../lib/missionContextApi";

vi.mock("../SmartViewer/DocumentMarkdown", () => ({
  DocumentMarkdown: ({ text }: { text: string }) => <div data-testid="doc-markdown">{text}</div>,
}));

import { DecisionsDetail } from "./MissionSlice2Details";

describe("DecisionsDetail", () => {
  const artifact: DecisionsArtifact = {
    kind: "decisions",
    label: "Decisions",
    state: "available",
    summary: "Pick the review source.",
    receipt: "ADR-300",
    detail: {
      type: "decisions",
      truncated: false,
      malformedCount: 0,
      entries: [
        {
          adrId: "ADR-300",
          title: "Pick the review source",
          markdown: "### ADR-300\nbody",
          source: "decision_log",
        },
      ],
    },
  };

  it("renders each ADR's own Markdown through the shared document renderer", () => {
    render(<DecisionsDetail artifact={artifact} />);
    expect(screen.getByTestId("artifact-decision-entry")).toHaveAttribute("data-adr", "ADR-300");
    expect(screen.getByTestId("doc-markdown")).toHaveTextContent("### ADR-300");
  });

  it("discloses truncation", () => {
    render(
      <DecisionsDetail artifact={{ ...artifact, detail: { ...artifact.detail!, truncated: true } }} />,
    );
    expect(screen.getByTestId("artifact-decisions-truncated")).toBeInTheDocument();
  });

  it("says so plainly when the run recorded no decisions", () => {
    render(
      <DecisionsDetail artifact={{ ...artifact, detail: { ...artifact.detail!, entries: [] } }} />,
    );
    expect(screen.getByText("This run recorded no decisions.")).toBeInTheDocument();
  });

  it("marks a drop-sourced decision as decided-but-not-yet-published", () => {
    render(
      <DecisionsDetail
        artifact={{
          ...artifact,
          detail: {
            ...artifact.detail!,
            entries: [
              {
                adrId: null,
                title: "Read the drops",
                markdown: "### Read the drops\nbody",
                source: "drop",
              },
            ],
          },
        }}
      />,
    );
    // Real and recorded — it simply has no number yet. The wording must not
    // imply a fault, and no ADR id may be invented to fill the gap.
    expect(screen.getByTestId("artifact-decision-unnumbered")).toHaveTextContent(
      "Decided — not yet published in a release.",
    );
    expect(screen.getByTestId("artifact-decision-entry")).toHaveAttribute("data-adr", "");
    expect(screen.getByTestId("artifact-decision-entry")).toHaveAttribute("data-source", "drop");
    expect(screen.getByTestId("doc-markdown")).toHaveTextContent("Read the drops");
  });

  it("does NOT badge a numbered ADR from the aggregated log", () => {
    render(<DecisionsDetail artifact={artifact} />);
    expect(screen.queryByTestId("artifact-decision-unnumbered")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifact-decision-entry")).toHaveAttribute("data-adr", "ADR-300");
  });

  it("renders BOTH sources together, badging only the unnumbered one", () => {
    render(
      <DecisionsDetail
        artifact={{
          ...artifact,
          detail: {
            ...artifact.detail!,
            entries: [
              {
                adrId: "ADR-300",
                title: "Numbered",
                markdown: "### ADR-300\nbody",
                source: "decision_log",
              },
              { adrId: null, title: "Unnumbered", markdown: "### Unnumbered\nbody", source: "drop" },
            ],
          },
        }}
      />,
    );
    expect(screen.getAllByTestId("artifact-decision-entry")).toHaveLength(2);
    expect(screen.getAllByTestId("artifact-decision-unnumbered")).toHaveLength(1);
  });

  it("discloses drop records that could not be read", () => {
    render(
      <DecisionsDetail
        artifact={{ ...artifact, detail: { ...artifact.detail!, malformedCount: 2 } }}
      />,
    );
    // A half-written drop must not vanish just because a good one rendered.
    expect(screen.getByTestId("artifact-decisions-malformed")).toHaveTextContent(
      "2 further decision records could not be read.",
    );
  });

  it("stays silent about malformed records when there are none", () => {
    render(<DecisionsDetail artifact={artifact} />);
    expect(screen.queryByTestId("artifact-decisions-malformed")).not.toBeInTheDocument();
  });
});
