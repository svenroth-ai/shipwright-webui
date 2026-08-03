import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneTabBar } from "./PaneTabBar";

describe("PaneTabBar — compact direct workspace navigation", () => {
  it("renders exactly four equal direct destinations with no Session tab", () => {
    render(
      <PaneTabBar
        active="center"
        centerTab="terminal"
        onChange={vi.fn()}
        onCenterTabChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Viewer" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Session" })).toBeNull();
    expect(screen.getByTestId("pane-tab-left")).toHaveAttribute(
      "aria-controls",
      "task-pane-left",
    );
    expect(screen.getByTestId("pane-tab-terminal")).toHaveAttribute(
      "aria-controls",
      "task-center-panel-terminal",
    );
    expect(screen.getByTestId("pane-tab-transcript")).toHaveAttribute(
      "aria-controls",
      "task-center-panel-transcript",
    );
    expect(screen.getByTestId("pane-tab-right")).toHaveAttribute(
      "aria-controls",
      "task-pane-right",
    );
  });

  it("maps Transcript/Terminal to the centre pane plus the controlled centre value", () => {
    const onChange = vi.fn();
    const onCenterTabChange = vi.fn();
    render(
      <PaneTabBar
        active="left"
        centerTab="terminal"
        onChange={onChange}
        onCenterTabChange={onCenterTabChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pane-tab-transcript"));
    expect(onChange).toHaveBeenCalledWith("center");
    expect(onCenterTabChange).toHaveBeenCalledWith("transcript");
  });

  it("Files/Viewer change only the outer pane", () => {
    const onChange = vi.fn();
    const onCenterTabChange = vi.fn();
    render(
      <PaneTabBar
        active="center"
        centerTab="terminal"
        onChange={onChange}
        onCenterTabChange={onCenterTabChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pane-tab-right"));
    expect(onChange).toHaveBeenCalledWith("right");
    expect(onCenterTabChange).not.toHaveBeenCalled();
  });

  it("ArrowRight activates and focuses the next tab", () => {
    const onChange = vi.fn();
    const onCenterTabChange = vi.fn();
    render(
      <PaneTabBar
        active="center"
        centerTab="transcript"
        onChange={onChange}
        onCenterTabChange={onCenterTabChange}
      />,
    );
    const transcript = screen.getByTestId("pane-tab-transcript");
    transcript.focus();
    fireEvent.keyDown(transcript, { key: "ArrowRight" });
    expect(screen.getByTestId("pane-tab-terminal")).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("center");
    expect(onCenterTabChange).toHaveBeenCalledWith("terminal");
  });
});
