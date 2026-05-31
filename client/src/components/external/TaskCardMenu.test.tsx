/*
 * TaskCardMenu unit coverage — iterate-2026-05-31-reopen-done-task.
 *
 * The card ⋯-menu was extracted from TaskCard.tsx. These tests pin the
 * per-item gating (Move to Backlog ↔ In-Progress, Re-open ↔ done) and that
 * each gated item fires its callback. Full integration through the real
 * hooks + /reopen endpoint lives in TaskCard.test.tsx.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { TaskCardMenu } from "./TaskCardMenu";

function renderMenu(
  overrides: Partial<Parameters<typeof TaskCardMenu>[0]> = {},
) {
  const props = {
    taskId: "t1",
    canMoveToBacklog: false,
    isDone: false,
    onEdit: vi.fn(),
    onBacklog: vi.fn(),
    onReopen: vi.fn(),
    onClose: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<TaskCardMenu {...props} />);
  return props;
}

describe("TaskCardMenu", () => {
  it("shows the Re-open item only when isDone", async () => {
    const user = userEvent.setup();
    renderMenu({ isDone: true });
    await user.click(screen.getByTestId("task-card-menu-t1"));
    expect(
      await screen.findByTestId("task-card-reopen-t1"),
    ).toBeInTheDocument();
  });

  it("hides the Re-open item when not done", async () => {
    const user = userEvent.setup();
    renderMenu({ isDone: false });
    await user.click(screen.getByTestId("task-card-menu-t1"));
    await screen.findByTestId("task-card-delete-t1"); // menu is open
    expect(screen.queryByTestId("task-card-reopen-t1")).toBeNull();
  });

  it("shows Move to Backlog only when canMoveToBacklog", async () => {
    const user = userEvent.setup();
    renderMenu({ canMoveToBacklog: true });
    await user.click(screen.getByTestId("task-card-menu-t1"));
    expect(
      await screen.findByTestId("task-card-backlog-t1"),
    ).toBeInTheDocument();
  });

  it("fires onReopen when Re-open is selected", async () => {
    const user = userEvent.setup();
    const props = renderMenu({ isDone: true });
    await user.click(screen.getByTestId("task-card-menu-t1"));
    await user.click(await screen.findByTestId("task-card-reopen-t1"));
    expect(props.onReopen).toHaveBeenCalledTimes(1);
    expect(props.onBacklog).not.toHaveBeenCalled();
  });
});
