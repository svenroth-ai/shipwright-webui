import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ListLoadErrorState } from "./ListLoadErrorState";

// @covers FR-01.01
describe("ListLoadErrorState", () => {
  it("renders a distinct error message (not the onboarding empty-state copy) and calls onRetry", () => {
    const onRetry = vi.fn();
    render(<ListLoadErrorState testId="task-board-load-error" label="tasks" onRetry={onRetry} />);

    expect(screen.getByTestId("task-board-load-error")).toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
    expect(screen.queryByText(/no tasks yet/i)).toBeNull();

    fireEvent.click(screen.getByTestId("task-board-load-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("interpolates the given label into both the heading and the retry testid stays stable", () => {
    render(<ListLoadErrorState testId="projects-load-error" label="projects" onRetry={() => {}} />);
    expect(screen.getByText(/couldn.t load projects/i)).toBeInTheDocument();
    expect(screen.getByTestId("projects-load-error-retry")).toBeInTheDocument();
  });
});
