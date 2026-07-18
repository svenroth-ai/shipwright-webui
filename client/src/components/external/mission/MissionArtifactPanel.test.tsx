/*
 * MissionArtifactPanel.test.tsx — the two-region right panel (AC3, CONTRACT §7).
 *
 * Region 1 is the plain-language summary; region 2 is the DISCRIMINATED detail.
 * The cases pin that each artifact type renders ITS OWN shape (a document, a
 * requirement list, commit metadata) rather than one generic blob, and that a
 * document which vanished since the context response reads as `stale` — never
 * as some other file's contents.
 *
 * @covers FR-01.66
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ArtifactDescriptor, ArtifactDocumentResponse } from "../../../lib/missionContextApi";

const docMock = vi.fn<() => {
  data: ArtifactDocumentResponse | undefined;
  isPending: boolean;
  isError: boolean;
}>();
vi.mock("../../../hooks/useMissionContext", () => ({
  useArtifactDocument: () => docMock(),
}));
// DocumentMarkdown carries its own rendering tests (and pulls a large plugin
// chain); stub it so these cases stay about the PANEL's structure.
vi.mock("../SmartViewer/DocumentMarkdown", () => ({
  DocumentMarkdown: ({ text }: { text: string }) => <div data-testid="doc-markdown">{text}</div>,
}));

import { MissionArtifactPanel } from "./MissionArtifactPanel";

const SPEC: ArtifactDescriptor = {
  kind: "spec",
  label: "Spec",
  state: "available",
  summary: "The plan this change was built to.",
  receipt: "mini-plan.md",
  detail: { type: "document", documentId: "opaque-id", title: "mini-plan.md" },
};

const REQUIREMENT: ArtifactDescriptor = {
  kind: "requirement",
  label: "Requirement",
  state: "available",
  summary: "Changed Embedded terminal.",
  receipt: "FR-01.28",
  detail: {
    type: "requirements",
    confidence: "finalized",
    rows: [
      {
        originalFrId: "FR-01.44",
        displayFrId: "FR-01.28",
        name: "Embedded terminal",
        area: "TRM",
        mappedFrom: "FR-01.44",
      },
    ],
    specImpact: "modify",
  },
};

const COMMIT: ArtifactDescriptor = {
  kind: "commit",
  label: "Commit",
  state: "available",
  summary: "Ship it. Delivered — merged into the main line.",
  receipt: "abc1234",
  detail: {
    type: "commit",
    commit: "abc1234def5678",
    message: "feat(mission): resolver",
    prNumber: 290,
    prUrl: "https://github.com/o/r/pull/290",
    merge: "merged",
  },
};

beforeEach(() => {
  docMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

function setup(artifact: ArtifactDescriptor, onClose = vi.fn()) {
  render(<MissionArtifactPanel taskId="task-1" artifact={artifact} onClose={onClose} />);
  return { onClose };
}

describe("two-region layout", () => {
  it("renders the business summary ABOVE the detail region", () => {
    docMock.mockReturnValue({
      data: { status: "ok", document: { title: "mini-plan.md", body: "# Plan" } },
      isPending: false,
      isError: false,
    });
    setup(SPEC);
    const summary = screen.getByTestId("artifact-summary");
    const detail = screen.getByTestId("artifact-detail");
    expect(summary).toHaveTextContent("The plan this change was built to.");
    // DOM order is the layout contract: summary first, document below.
    expect(summary.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("closes on the close button and on Escape", () => {
    const { onClose } = setup(SPEC);
    fireEvent.click(screen.getByTestId("artifact-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on the scrim", () => {
    const { onClose } = setup(SPEC);
    fireEvent.click(screen.getByTestId("artifact-scrim"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("spec detail (document)", () => {
  it("renders the fetched body through DocumentMarkdown", () => {
    docMock.mockReturnValue({
      data: { status: "ok", document: { title: "mini-plan.md", body: "# Plan\n\nbody text" } },
      isPending: false,
      isError: false,
    });
    setup(SPEC);
    expect(screen.getByTestId("doc-markdown")).toHaveTextContent("body text");
  });

  it("shows a loading note while the body is in flight", () => {
    docMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    setup(SPEC);
    expect(screen.getByTestId("artifact-doc-loading")).toBeInTheDocument();
  });

  it("reports a STALE document instead of rendering an unrelated file (AC3)", () => {
    docMock.mockReturnValue({ data: { status: "stale" }, isPending: false, isError: false });
    setup(SPEC);
    expect(screen.getByTestId("artifact-doc-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-markdown")).not.toBeInTheDocument();
  });

  it("reports a fetch error honestly", () => {
    docMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    setup(SPEC);
    expect(screen.getByTestId("artifact-doc-error")).toBeInTheDocument();
  });
});

describe("requirement detail (structured rows)", () => {
  it("renders the fold provenance on a mapped row", () => {
    setup(REQUIREMENT);
    expect(screen.getByTestId("artifact-req-rows")).toHaveTextContent(
      "FR-01.28 — Embedded terminal (mapped from FR-01.44)",
    );
  });

  it("labels a mid-run requirement as PLANNED, not decided", () => {
    setup({
      ...REQUIREMENT,
      detail: { ...REQUIREMENT.detail!, confidence: "planned" },
    } as ArtifactDescriptor);
    expect(screen.getByTestId("artifact-req-confidence")).toHaveTextContent("Planned impact");
  });

  it("does NOT render a document region for a requirement", () => {
    setup(REQUIREMENT);
    expect(screen.queryByTestId("doc-markdown")).not.toBeInTheDocument();
  });
});

describe("commit detail (metadata + PR link)", () => {
  it("renders the merge state in words and links the PR externally", () => {
    setup(COMMIT);
    expect(screen.getByTestId("artifact-commit-merge")).toHaveTextContent("Merged");
    const link = screen.getByRole("link", { name: "#290" });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/pull/290");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("says 'Not merged yet' for a pending delivery — never claims merged", () => {
    setup({
      ...COMMIT,
      detail: { ...COMMIT.detail!, merge: "pending" },
    } as ArtifactDescriptor);
    expect(screen.getByTestId("artifact-commit-merge")).toHaveTextContent("Not merged yet");
  });

  it("says the state is unknown when the merge could not be checked", () => {
    setup({
      ...COMMIT,
      detail: { ...COMMIT.detail!, merge: "unknown" },
    } as ArtifactDescriptor);
    expect(screen.getByTestId("artifact-commit-merge")).toHaveTextContent("unknown");
  });
});
