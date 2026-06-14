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

describe("TaskList — title column width (iterate tablet-view-polish AC-4)", () => {
  it("title column is greedy (w-full) so it stays the widest column at small resolutions", () => {
    renderList([baseTask({ taskId: "t-w", title: "A long enough task title" })]);
    // The greedy `width:100%` column absorbs the remaining row width while the
    // whitespace-nowrap content columns size to their content → title widest.
    const titleHeader = screen.getByTestId("task-list-header-title");
    expect(titleHeader.className).toContain("w-full");
    const titleCell = screen.getByTestId("task-list-cell-t-w-title");
    expect(titleCell.className).toContain("w-full");
    // Sibling content columns must NOT be greedy (else they'd fight the title).
    expect(screen.getByTestId("task-list-header-state").className).not.toContain(
      "w-full",
    );
    expect(screen.getByTestId("task-list-header-updated").className).not.toContain(
      "w-full",
    );
  });
});

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

describe("TaskList — title-column truncation (no right-cutoff regression)", () => {
  // Sven UAT 2026-06-12: the table was clipped on the right (Commit/Updated/
  // Actions columns disappeared) because the Title cell is `whitespace-nowrap`
  // (truncate) — in an auto-layout table that lets the Title column grow to its
  // full content width, pushing the table past the container, where the
  // wrapper's `overflow-hidden` clipped the overflow. The fix caps the Title
  // cell with `max-w-0` so the column absorbs leftover width and ellipsizes
  // instead of overflowing. This pins the truncation affordance.
  it("Title cell carries max-w-0 + a truncating title span", () => {
    renderList([
      baseTask({
        taskId: "t-long",
        title:
          "Fix for Consolidate 3 repo-root resolvers into lib/repo_root.py (events_log.resolve_main_repo_root is in the wrong module)",
      }),
    ]);
    const cell = screen.getByTestId("task-list-cell-t-long-title");
    expect(cell.className).toMatch(/\bmax-w-0\b/);
    const title = screen.getByTestId("task-list-title-t-long");
    expect(title.className).toContain("truncate");
  });
});
