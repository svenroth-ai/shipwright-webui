/*
 * TaskCard — lead surface (FR-04.11, iterate-2026-09-01-lead-board-surface).
 * New test file rather than extending TaskCard.test.tsx (already at its
 * bloat-baseline current with zero headroom — internal plan review).
 *
 * Covers: the bot glyph gate, the expander's render-gate, and — the actual
 * risk this feature carries — that the expander never breaks the card's
 * pre-existing whole-card-click/Enter navigates-to-detail behavior, via
 * mouse AND keyboard, and never leaks a keydown to an ancestor the way
 * TaskBoardColumns' dnd-kit DraggableCard wrapper would see it (mirrors the
 * mocking pattern already established in TaskCard.keydown.test.tsx).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Audit drift",
    cwd: "/tmp/project",
    pluginDirs: [],
    projectId: "project-001",
    state: "draft",
    createdAt: "2026-04-23T15:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function renderCard(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskCard task={task} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => navigate.mockClear());

describe("TaskCard — bot glyph (FR-04.11 (c))", () => {
  // The vocabulary-gating matrix (renders for lead:, not for lead-wait:-only
  // /lead-dedup:-only/no-tags) is TaskCardLeadExpander.test.tsx's job — a
  // unit test doesn't need a full TaskCard mount to prove it, and duplicating
  // it here added no coverage (code review finding). What ONLY an in-context
  // mount can prove is AC (c)'s actual wording — "next to the ProjectPill" —
  // so that's the one thing this file asserts.
  // @covers FR-01.01
  it("renders immediately before the project pill in the meta row (AC (c): 'next to')", () => {
    renderCard(baseTask({ tags: ["lead:helper-01"] }));
    const glyph = screen.getByTestId("task-card-lead-glyph-task-1");
    const pill = screen.getByTestId("task-card-project-task-1");
    expect(glyph.nextElementSibling).toBe(pill);
  });
});

describe("TaskCard — lead expander mounted in the real card", () => {
  // Smoke test that TaskCardLeadExpander is actually wired into TaskCard
  // (not just imported) — the render-gate matrix itself lives in
  // TaskCardLeadExpander.test.tsx.
  // @covers FR-01.01
  it("renders the expander toggle for a lead-tagged task and not for an ordinary one", () => {
    renderCard(baseTask({ tags: ["lead-wait:po"] }));
    expect(screen.getByTestId("task-card-lead-expander-toggle-task-1")).toBeInTheDocument();
  });
});

describe("TaskCard — expander vs. whole-card navigation (FR-04.11 (b))", () => {
  // @covers FR-01.01
  it("clicking the card body still navigates to detail (existing behavior preserved)", async () => {
    const user = userEvent.setup();
    renderCard(baseTask({ tags: ["lead:helper-01"] }));
    await user.click(screen.getByTestId("task-card-task-1"));
    expect(navigate).toHaveBeenCalledWith("/tasks/task-1");
  });

  // @covers FR-01.01
  it("clicking the expander toggle opens it in place and does NOT navigate", async () => {
    const user = userEvent.setup();
    renderCard(baseTask({ tags: ["lead:helper-01"] }));
    await user.click(screen.getByTestId("task-card-lead-expander-toggle-task-1"));
    expect(screen.getByTestId("task-card-lead-expander-body-task-1")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  // @covers FR-01.01
  it("clicking inside the OPEN expander panel does NOT navigate either", async () => {
    const user = userEvent.setup();
    renderCard(baseTask({ tags: ["lead:helper-01"], priority: "P0" }));
    await user.click(screen.getByTestId("task-card-lead-expander-toggle-task-1"));
    await user.click(screen.getByTestId("task-card-lead-priority-task-1"));
    expect(navigate).not.toHaveBeenCalled();
  });

  // @covers FR-01.01
  it("Enter on the card itself still navigates (pre-existing guard, unbroken by the new expander)", () => {
    renderCard(baseTask({ tags: ["lead:helper-01"] }));
    fireEvent.keyDown(screen.getByTestId("task-card-task-1"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/tasks/task-1");
  });

  // @covers FR-01.01
  it("Enter on the expander toggle does NOT navigate and does not reach a simulated dnd-kit ancestor keydown listener", async () => {
    // TaskBoardColumns' DraggableCard wraps every TaskCard in a div carrying
    // dnd-kit's useDraggable listeners (incl. a KeyboardSensor) — a
    // component this test doesn't import, so it stands in with a plain
    // keydown spy on an ancestor, exactly what internal plan review flagged.
    const onAncestorKeyDown = vi.fn();
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <div onKeyDown={onAncestorKeyDown}>
            <TaskCard task={baseTask({ tags: ["lead:helper-01"] })} />
          </div>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    screen.getByTestId("task-card-lead-expander-toggle-task-1").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("task-card-lead-expander-body-task-1")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(onAncestorKeyDown).not.toHaveBeenCalled();
  });
});
