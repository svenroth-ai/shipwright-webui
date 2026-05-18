/*
 * TaskDescriptionDisclosure — unit coverage.
 * iterate-2026-05-18-edit-task-dialog (AC-5).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TaskDescriptionDisclosure } from "./TaskDescriptionDisclosure";
import type { ExternalTask } from "../../lib/externalApi";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "T",
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p1",
    state: "active",
    createdAt: "2026-05-18T10:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("TaskDescriptionDisclosure", () => {
  it("renders the description, expanded by default", () => {
    render(<TaskDescriptionDisclosure task={baseTask({ description: "the brief" })} />);
    expect(screen.getByTestId("task-description-disclosure")).toBeInTheDocument();
    expect(screen.getByTestId("task-description-body")).toHaveTextContent("the brief");
  });

  it("renders nothing when the task has no description", () => {
    render(<TaskDescriptionDisclosure task={baseTask()} />);
    expect(screen.queryByTestId("task-description-disclosure")).toBeNull();
  });

  it("renders nothing for a whitespace-only description", () => {
    render(<TaskDescriptionDisclosure task={baseTask({ description: "   \n  " })} />);
    expect(screen.queryByTestId("task-description-disclosure")).toBeNull();
  });

  it("collapses + expands on toggle", async () => {
    const user = userEvent.setup();
    render(<TaskDescriptionDisclosure task={baseTask({ description: "the brief" })} />);
    expect(screen.getByTestId("task-description-body")).toBeInTheDocument();
    await user.click(screen.getByTestId("task-description-toggle"));
    expect(screen.queryByTestId("task-description-body")).toBeNull();
    await user.click(screen.getByTestId("task-description-toggle"));
    expect(screen.getByTestId("task-description-body")).toBeInTheDocument();
  });

  it("persists the collapsed state across remounts (localStorage)", async () => {
    const user = userEvent.setup();
    const task = baseTask({ description: "the brief" });
    const { unmount } = render(<TaskDescriptionDisclosure task={task} />);
    await user.click(screen.getByTestId("task-description-toggle"));
    expect(screen.queryByTestId("task-description-body")).toBeNull();
    unmount();
    // Fresh mount reads the collapse preference back from localStorage.
    render(<TaskDescriptionDisclosure task={task} />);
    expect(screen.queryByTestId("task-description-body")).toBeNull();
    expect(screen.getByTestId("task-description-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders HTML-like content inertly as text (XSS-safe)", () => {
    const evil = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    render(<TaskDescriptionDisclosure task={baseTask({ description: evil })} />);
    const body = screen.getByTestId("task-description-body");
    // The payload is present as TEXT, not as live DOM nodes.
    expect(body).toHaveTextContent(evil);
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
  });
});
