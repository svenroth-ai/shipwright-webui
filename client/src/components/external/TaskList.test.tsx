/*
 * Tests for TaskList — focus on the v0.4.2 phase-column rendering.
 *
 * The list view used to render `—` for every task in the Phase column
 * (pre-fix the Phase chip was deferred behind ADR-045). This suite
 * verifies the column now uses the same source-priority chain as
 * TaskCard / TaskDetailHeader.
 */

import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TaskList } from "./TaskList";
import type { ExternalTask } from "../../lib/externalApi";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Audit drift",
    cwd: "/tmp/project",
    pluginDirs: [],
    projectId: "project-001",
    state: "draft",
    createdAt: "2026-04-26T10:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function renderList(tasks: ExternalTask[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskList tasks={tasks} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskList — phase column (v0.4.2)", () => {
  it("renders the phase badge when task.phase + task.phaseLabel are persisted", () => {
    renderList([
      baseTask({
        taskId: "t-with-phase",
        phase: "compliance",
        phaseLabel: "Compliance",
      }),
    ]);
    const badge = screen.getByTestId("task-list-phase-t-with-phase");
    expect(badge.textContent).toContain("Compliance");
    expect(badge.dataset.phase).toBe("compliance");
    expect(badge.dataset.phaseSource).toBe("task");
  });

  it("falls back to title-keyword derivation when persisted phase is missing", () => {
    renderList([
      baseTask({
        taskId: "t-fallback",
        title: "Build login flow",
      }),
    ]);
    const badge = screen.getByTestId("task-list-phase-t-fallback");
    expect(badge.textContent).toContain("Build");
    expect(badge.dataset.phase).toBe("build");
    expect(badge.dataset.phaseSource).toBe("title-fallback");
  });

  it("renders the em-dash placeholder when neither phase nor title-fallback resolves", () => {
    renderList([
      baseTask({
        taskId: "t-no-phase",
        title: "Random title",
      }),
    ]);
    expect(screen.queryByTestId("task-list-phase-t-no-phase")).toBeNull();
    // Em-dash placeholder still inside the cell so column width stays stable.
    const cell = screen.getByTestId("task-list-cell-t-no-phase-phase");
    expect(cell.textContent).toContain("—");
  });

  it("v0.4.1 word-boundary fix: webui in title does NOT trigger Design", () => {
    renderList([
      baseTask({
        taskId: "t-webui",
        title: "WebUI Repo Adopten",
      }),
    ]);
    const badge = screen.getByTestId("task-list-phase-t-webui");
    expect(badge.dataset.phase).toBe("adopt");
    expect(badge.textContent).toContain("Adopt");
  });
});
