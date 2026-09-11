import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TaskBoardBody } from "./TaskBoardBody";
import type { ExternalTask } from "../../lib/externalApi";

// Stub the heavier children — this test only proves TaskBoardBody's own
// branch selection, not their internals (each has its own test coverage).
vi.mock("./TaskBoardColumns", () => ({
  TaskBoardColumns: () => <div data-testid="stub-columns" />,
}));
vi.mock("./TaskList", () => ({
  TaskList: () => <div data-testid="stub-list" />,
}));

const TASK = { taskId: "t1" } as unknown as ExternalTask;

function baseProps() {
  return {
    isLoading: false,
    tasksError: false,
    onRetryTasks: vi.fn(),
    noFilterMatches: false,
    onClearFilters: vi.fn(),
    view: "board" as const,
    projectFiltered: [TASK],
    filteredTasks: [TASK],
    onCreate: vi.fn(),
  };
}

describe("TaskBoardBody", () => {
  // @covers FR-01.01
  it("shows Loading… while isLoading, before any other branch", () => {
    render(<TaskBoardBody {...baseProps()} isLoading tasksError />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  // @covers FR-01.01 — trg-0f040744 finding 1
  it("shows the load-error state (not the empty state) when tasksError is true", () => {
    render(<TaskBoardBody {...baseProps()} tasksError projectFiltered={[]} filteredTasks={[]} />);
    expect(screen.getByTestId("task-board-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("task-board-empty")).toBeNull();
  });

  it("load-error retry calls onRetryTasks", async () => {
    const onRetryTasks = vi.fn();
    render(<TaskBoardBody {...baseProps()} tasksError onRetryTasks={onRetryTasks} />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByTestId("task-board-load-error-retry"));
    expect(onRetryTasks).toHaveBeenCalledTimes(1);
  });

  it("shows the no-filter-matches state when noFilterMatches is true", () => {
    render(<TaskBoardBody {...baseProps()} noFilterMatches />);
    expect(screen.getByTestId("task-board-no-filter-matches")).toBeInTheDocument();
  });

  it("renders the list view when view is 'list'", () => {
    render(<TaskBoardBody {...baseProps()} view="list" />);
    expect(screen.getByTestId("stub-list")).toBeInTheDocument();
  });

  it("shows the A07 empty state when projectFiltered is empty (genuinely zero tasks)", () => {
    render(<TaskBoardBody {...baseProps()} projectFiltered={[]} filteredTasks={[]} />);
    expect(screen.getByTestId("task-board-empty")).toBeInTheDocument();
  });

  it("renders the kanban columns as the default case", () => {
    render(<TaskBoardBody {...baseProps()} />);
    expect(screen.getByTestId("stub-columns")).toBeInTheDocument();
  });
});
