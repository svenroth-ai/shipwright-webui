/* V8: desktop right-card collapse is reachable from the card head and comes back from the middle head. */

import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TaskDetailThreePane } from "./TaskDetailThreePane";
import { ViewerToggle } from "./ViewerToggle";
import { useFocusMode } from "./focus-mode-context";

function Collapse() {
  const { sidebar } = useFocusMode();
  return sidebar.available ? (
    <button data-testid="collapse" onClick={sidebar.toggle}>
      hide
    </button>
  ) : null;
}

beforeEach(() => localStorage.clear());

describe("TaskDetailThreePane — desktop sidebar collapse (V8)", () => {
  it("collapse hides the right pane; the middle head toggle brings it back", () => {
    render(
      <TaskDetailThreePane
        containerWidth={1400}
        left={<div />}
        center={<ViewerToggle />}
        right={<Collapse />}
      />,
    );
    // Open: the middle head offers no toggle (the card head owns "hide").
    expect(screen.queryByTestId("viewer-toggle")).toBeNull();
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
    fireEvent.click(screen.getByTestId("collapse"));
    expect(screen.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(screen.getByTestId("viewer-toggle"));
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
    expect(screen.queryByTestId("viewer-toggle")).toBeNull();
  });

  it("opening a file (viewerRequestKey bump) reveals a collapsed right pane", () => {
    const ui = (key: number) => (
      <TaskDetailThreePane
        containerWidth={1400}
        viewerRequestKey={key}
        left={<div />}
        center={<div />}
        right={<Collapse />}
      />
    );
    const { rerender } = render(ui(0));
    fireEvent.click(screen.getByTestId("collapse"));
    expect(screen.getByTestId("pane-right")).toHaveAttribute("data-collapsed", "true");
    rerender(ui(1));
    expect(screen.getByTestId("pane-right")).not.toHaveAttribute("data-collapsed");
  });
});
