import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { RecordRail } from "./RecordRail";
import type { RecordNodeView } from "../../../lib/recordNodes";

const NODES: RecordNodeView[] = [
  { key: "req", label: "Requirement", receipt: "FR-01.55", caption: "c", state: "done" },
  { key: "spec", label: "Spec", receipt: "added", caption: "c", state: "done" },
  { key: "tests", label: "Tests", receipt: "9/12", caption: "c", state: "now" },
  { key: "review", label: "Review", receipt: null, caption: "c", state: "pending" },
  { key: "commit", label: "Commit", receipt: null, caption: "c", state: "pending" },
];

function setup(overrides: Partial<React.ComponentProps<typeof RecordRail>> = {}) {
  const onNodeClick = vi.fn();
  const onToggleCollapse = vi.fn();
  render(
    <RecordRail
      nodes={NODES}
      activeNodeKey={null}
      collapsed={false}
      onNodeClick={onNodeClick}
      onToggleCollapse={onToggleCollapse}
      {...overrides}
    />,
  );
  return { onNodeClick, onToggleCollapse };
}

describe("RecordRail", () => {
  it("renders the 'The Record' eyebrow + all five nodes", () => {
    setup();
    expect(screen.getByText("The Record")).toBeInTheDocument();
    for (const label of ["Requirement", "Spec", "Tests", "Review", "Commit"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows a receipt only where there is evidence — pending nodes carry none", () => {
    setup();
    expect(screen.getByText("FR-01.55")).toBeInTheDocument();
    expect(screen.getByText("9/12")).toBeInTheDocument();
    // Review + Commit are pending with null receipts → no receipt line renders.
    expect(screen.queryByText("clean")).not.toBeInTheDocument();
  });

  it("clicking a node fires onNodeClick with its key", () => {
    const { onNodeClick } = setup();
    fireEvent.click(screen.getByTestId("record-node-tests"));
    expect(onNodeClick).toHaveBeenCalledWith("tests");
  });

  it("the collapse control fires onToggleCollapse", () => {
    const { onToggleCollapse } = setup();
    fireEvent.click(screen.getByTestId("record-collapse"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapsed → the rail carries the collapsed marker (labels hidden via CSS)", () => {
    setup({ collapsed: true });
    expect(screen.getByTestId("record-rail")).toHaveAttribute("data-collapsed", "true");
  });

  it("conveys state by label, not colour alone (state word is in the a11y name)", () => {
    setup();
    // "now" node exposes its state textually for screen readers.
    expect(screen.getByTestId("record-node-tests")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("in progress"),
    );
    expect(screen.getByTestId("record-node-review")).toHaveAttribute("data-state", "pending");
  });
});
