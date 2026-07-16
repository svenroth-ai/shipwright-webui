/*
 * Task-Board teaching empty state (A07 / FR-01.50).
 *
 * Asserts the AC1 shape: one teaching sentence + EXACTLY one call to action.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskBoardEmptyState } from "./TaskBoardEmptyState";

afterEach(() => cleanup());

describe("TaskBoardEmptyState", () => {
  it("renders the teaching sentence", () => {
    render(<TaskBoardEmptyState onCreate={() => {}} canCreate />);
    expect(screen.getByTestId("task-board-empty-sentence")).toHaveTextContent(
      "Runs, iterates, and plain sessions you launch all land on this board.",
    );
  });

  it("offers EXACTLY one call to action", () => {
    render(<TaskBoardEmptyState onCreate={() => {}} canCreate />);
    const block = screen.getByTestId("task-board-empty");
    expect(within(block).getAllByRole("button")).toHaveLength(1);
  });

  it("the CTA opens the create flow", async () => {
    const onCreate = vi.fn();
    render(<TaskBoardEmptyState onCreate={onCreate} canCreate />);
    await userEvent.click(screen.getByTestId("task-board-empty-cta"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("disables the CTA while the action catalog is still loading", () => {
    render(<TaskBoardEmptyState onCreate={() => {}} canCreate={false} />);
    expect(screen.getByTestId("task-board-empty-cta")).toBeDisabled();
  });
});
