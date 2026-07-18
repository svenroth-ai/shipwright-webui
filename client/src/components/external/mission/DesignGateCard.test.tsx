import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ExternalTask } from "../../../lib/externalApi";

// Stub the children so this test is about the CARD's composition + wiring, not
// the gallery/decision internals (which carry their own tests).
vi.mock("./DesignGateGallery", () => ({
  DesignGateGallery: ({ onOpenPreview }: { onOpenPreview: () => void }) => (
    <button data-testid="stub-open-preview" onClick={onOpenPreview}>
      gallery
    </button>
  ),
}));
vi.mock("./DesignGateDecision", () => ({
  DesignGateDecision: ({
    onRequestChanges,
    savedRound,
  }: {
    onRequestChanges: () => void;
    savedRound: number | null;
  }) => (
    <div>
      <button data-testid="stub-request-changes" onClick={onRequestChanges}>
        decide
      </button>
      <span data-testid="stub-saved-round">{savedRound ?? "none"}</span>
    </div>
  ),
}));
vi.mock("../MockupReviewOverlay", () => ({
  MockupReviewOverlay: ({
    open,
    onFeedbackSaved,
  }: {
    open: boolean;
    onFeedbackSaved?: (round: number) => void;
  }) => (
    <div data-testid="stub-overlay" data-open={String(open)}>
      <button data-testid="stub-fire-feedback" onClick={() => onFeedbackSaved?.(3)}>
        save
      </button>
    </div>
  ),
}));

import { DesignGateCard } from "./DesignGateCard";

const TASK = { taskId: "t1", projectId: "p1" } as unknown as ExternalTask;

afterEach(() => vi.clearAllMocks());

describe("DesignGateCard — the gate IS the middle .mc-op card (A14, AC1)", () => {
  // @covers FR-01.45
  it("renders as the .mc-op glass card in designgate state (no new glass recipe)", () => {
    const { container } = render(<DesignGateCard task={TASK} />);
    const card = screen.getByTestId("design-gate-card");
    expect(card).toHaveClass("mc-op");
    expect(card).toHaveAttribute("data-state", "designgate");
    // Reuses the same middle-slot shell — no foreign page wrapper.
    expect(container.querySelector(".mc-op")).toBe(card);
  });

  // @covers FR-01.45
  it("the overlay starts closed and opens from the gallery preview click", () => {
    render(<DesignGateCard task={TASK} />);
    expect(screen.getByTestId("stub-overlay")).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByTestId("stub-open-preview"));
    expect(screen.getByTestId("stub-overlay")).toHaveAttribute("data-open", "true");
  });

  // @covers FR-01.45
  it("'Request changes' opens the same review viewer", () => {
    render(<DesignGateCard task={TASK} />);
    fireEvent.click(screen.getByTestId("stub-request-changes"));
    expect(screen.getByTestId("stub-overlay")).toHaveAttribute("data-open", "true");
  });

  // @covers FR-01.45
  it("a saved feedback round flows down to the decision bar", () => {
    render(<DesignGateCard task={TASK} />);
    expect(screen.getByTestId("stub-saved-round")).toHaveTextContent("none");
    fireEvent.click(screen.getByTestId("stub-fire-feedback"));
    expect(screen.getByTestId("stub-saved-round")).toHaveTextContent("3");
  });
});
