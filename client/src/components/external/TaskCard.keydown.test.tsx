/*
 * TaskCard keydown-navigation guard — iterate-2026-06-17.
 *
 * Regression test for a bug the external code-review cascade surfaced:
 * the "Move to…" ⋯-menu items are rendered in a Radix Portal, but React
 * propagates events through the COMPONENT tree, so pressing Enter to select
 * a menu item bubbled up to the card's `onKeyDown` and navigated the user to
 * the detail page. The card must navigate ONLY when it is itself focused
 * (`ev.target === ev.currentTarget`).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { TaskCard } from "./TaskCard";
import type { ExternalTask } from "../../lib/externalApi";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

function task(): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "u",
    title: "T",
    cwd: "/tmp",
    pluginDirs: [],
    projectId: "p",
    state: "draft",
    createdAt: "2026-06-17T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
  } as ExternalTask;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCard task={task()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => navigate.mockClear());

describe("TaskCard keydown navigation guard", () => {
  it("navigates when Enter is pressed on the card itself", () => {
    renderCard();
    fireEvent.keyDown(screen.getByTestId("task-card-task-1"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/tasks/task-1");
  });

  it("does NOT navigate when Enter bubbles from a child (e.g. the ⋯-menu)", () => {
    renderCard();
    fireEvent.keyDown(screen.getByTestId("task-card-menu-task-1"), { key: "Enter" });
    expect(navigate).not.toHaveBeenCalled();
  });
});
