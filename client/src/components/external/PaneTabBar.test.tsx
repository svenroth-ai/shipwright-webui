import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneTabBar } from "./PaneTabBar";

describe("PaneTabBar — compact direct workspace navigation", () => {
  it("renders exactly three equal direct destinations with no Transcript/Session tab", () => {
    render(<PaneTabBar active="center" onChange={vi.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Viewer" })).toBeInTheDocument();
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
});
