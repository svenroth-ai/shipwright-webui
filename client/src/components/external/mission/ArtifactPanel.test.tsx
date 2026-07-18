import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ArtifactPanel } from "./ArtifactPanel";
import type { RecordNodeView } from "../../../lib/recordNodes";

const SPEC_NODE: RecordNodeView = {
  key: "spec",
  label: "Spec",
  receipt: "added",
  caption: "The written definition of done, diffed on this run.",
  state: "done",
};

const EMPTY_COMMIT: RecordNodeView = {
  key: "commit",
  label: "Commit",
  receipt: null,
  caption: "Spec, changelog, decision log moved in lockstep.",
  state: "pending",
};

function setup(node: RecordNodeView = SPEC_NODE) {
  const onClose = vi.fn();
  const onOpenDocument = vi.fn();
  render(<ArtifactPanel node={node} onClose={onClose} onOpenDocument={onOpenDocument} />);
  return { onClose, onOpenDocument };
}

describe("ArtifactPanel", () => {
  // @covers FR-01.66
  it("renders the node kind, artifact name and honest caption", () => {
    setup();
    const panel = screen.getByTestId("artifact-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "spec.md" })).toBeInTheDocument();
    expect(screen.getByText(/definition of done/i)).toBeInTheDocument();
  });

  // @covers FR-01.66
  it("a node with no evidence shows an honest empty title, not a fabricated value", () => {
    setup(EMPTY_COMMIT);
    expect(screen.getByRole("heading", { name: "No run data yet" })).toBeInTheDocument();
  });

  // @covers FR-01.66
  it("the close button fires onClose", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("artifact-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.66
  it("Escape closes the panel", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.66
  it("the scrim closes the panel (compact slide-over fallback)", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("artifact-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.66
  it("'Open full document' routes to the existing viewer", () => {
    const { onOpenDocument } = setup();
    fireEvent.click(screen.getByTestId("artifact-open-document"));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
  });

  // @covers FR-01.66
  it("focuses the close control on open and restores focus to the trigger on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const onOpenDocument = vi.fn();
    const { unmount } = render(
      <ArtifactPanel node={SPEC_NODE} onClose={onClose} onOpenDocument={onOpenDocument} />,
    );
    expect(document.activeElement).toBe(screen.getByTestId("artifact-close"));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  // @covers FR-01.66
  it("switching nodes updates the focus-return target (A→B closes back to B, not A)", () => {
    const triggerA = document.createElement("button");
    const triggerB = document.createElement("button");
    document.body.append(triggerA, triggerB);

    triggerA.focus();
    const { rerender, unmount } = render(
      <ArtifactPanel node={SPEC_NODE} onClose={vi.fn()} onOpenDocument={vi.fn()} />,
    );
    // Simulate clicking node B: B takes focus, then the panel re-renders for B.
    triggerB.focus();
    rerender(<ArtifactPanel node={EMPTY_COMMIT} onClose={vi.fn()} onOpenDocument={vi.fn()} />);

    unmount();
    expect(document.activeElement).toBe(triggerB);
    triggerA.remove();
    triggerB.remove();
  });
});
