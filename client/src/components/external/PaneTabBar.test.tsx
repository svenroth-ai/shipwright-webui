import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneTabBar } from "./PaneTabBar";

describe("PaneTabBar — compact direct workspace navigation", () => {
  // @covers FR-01.66
  it("renders exactly four direct destinations (Files, Terminal, Info, Viewer) and no Preview/Transcript/Session tab", () => {
    render(<PaneTabBar active="center" onChange={vi.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Viewer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Info" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Transcript" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Session" })).toBeNull();
    expect(screen.getByTestId("pane-tab-left")).toHaveAttribute(
      "aria-controls",
      "task-pane-left",
    );
    expect(screen.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-controls",
      "task-center-panel-terminal",
    );
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute(
      "aria-controls",
      "task-pane-right",
    );
  });

  it("maps Terminal to the centre pane", () => {
    const onChange = vi.fn();
    render(<PaneTabBar active="left" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("pane-tab-terminal"));
    expect(onChange).toHaveBeenCalledWith("center");
  });

  it("Files/Viewer change the outer pane", () => {
    const onChange = vi.fn();
    render(<PaneTabBar active="center" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("pane-tab-right"));
    expect(onChange).toHaveBeenCalledWith("right");
  });

  it("ArrowRight activates and focuses the next tab", () => {
    const onChange = vi.fn();
    render(<PaneTabBar active="left" onChange={onChange} />);
    const left = screen.getByTestId("pane-tab-left");
    left.focus();
    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(screen.getByTestId("pane-tab-terminal")).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("center");
  });

  // @covers FR-01.66
  it("Info and Viewer are two tabs of the right pane: they set the segment and select the pane", () => {
    const onChange = vi.fn();
    const onSegmentChange = vi.fn();
    render(
      <PaneTabBar active="center" segment="viewer" onChange={onChange} onSegmentChange={onSegmentChange} />,
    );
    fireEvent.click(screen.getByTestId("pane-tab-info"));
    expect(onSegmentChange).toHaveBeenLastCalledWith("info");
    expect(onChange).toHaveBeenLastCalledWith("right");
    fireEvent.click(screen.getByTestId("pane-tab-right"));
    expect(onSegmentChange).toHaveBeenLastCalledWith("viewer");
  });

  // @covers FR-01.66
  it("marks exactly one of Info / Viewer selected from the segment", () => {
    const { rerender } = render(<PaneTabBar active="right" segment="info" onChange={vi.fn()} />);
    expect(screen.getByTestId("pane-tab-info")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "false");
    rerender(<PaneTabBar active="right" segment="viewer" onChange={vi.fn()} />);
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute("aria-selected", "true");
  });

  // @covers FR-01.66
  it("renders its children (the Expand control) after the tabs, outside the tab roles", () => {
    render(
      <PaneTabBar active="center" onChange={vi.fn()}>
        <button data-testid="x-expand">e</button>
      </PaneTabBar>,
    );
    expect(screen.getByTestId("x-expand")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).not.toContainElement(screen.getByTestId("x-expand"));
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
});
