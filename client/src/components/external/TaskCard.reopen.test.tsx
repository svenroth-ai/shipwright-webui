/*
 * TaskCard — "Re-open" menu item (integration).
 * iterate-2026-05-31-reopen-done-task.
 *
 * Counterpart of "Move to Backlog" for the terminal `done` state, exercised
 * through the real <TaskCard> → <TaskCardMenu> → useReopenExternalTask chain.
 * Shown only for `done`; absent for draft + the five In-Progress states.
 * Selecting it POSTs /reopen (state → draft) so the card returns to Backlog.
 *
 * Split out of TaskCard.test.tsx (which is at its bloat-baseline ceiling) per
 * the project's "new file, don't ratchet" rule.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

import { TaskCard } from "./TaskCard";
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
    createdAt: "2026-05-31T15:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
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

describe("TaskCard — Re-open (reopen-done-task)", () => {
  it("shows the 'Re-open' menu item for a done task", async () => {
    const user = userEvent.setup();
    renderCard(baseTask({ state: "done" }));
    await user.click(screen.getByTestId("task-card-menu-task-1"));
    expect(
      await screen.findByTestId("task-card-reopen-task-1"),
    ).toBeInTheDocument();
  });

  it.each(["draft", "active", "idle", "awaiting_external_start"] as const)(
    "hides the 'Re-open' menu item for state=%s",
    async (state) => {
      const user = userEvent.setup();
      renderCard(baseTask({ state }));
      await user.click(screen.getByTestId("task-card-menu-task-1"));
      // Menu IS open (the always-present Delete item renders) — only the
      // reopen item is conditionally absent.
      await screen.findByTestId("task-card-delete-task-1");
      expect(screen.queryByTestId("task-card-reopen-task-1")).toBeNull();
    },
  );

  it("clicking 'Re-open' POSTs to the reopen endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ task: baseTask({ state: "draft" }) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderCard(baseTask({ state: "done" }));
      await user.click(screen.getByTestId("task-card-menu-task-1"));
      await user.click(await screen.findByTestId("task-card-reopen-task-1"));
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some((c) =>
            String(c[0]).includes("/api/external/tasks/task-1/reopen"),
          ),
        ).toBe(true);
      });
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/reopen"),
      );
      expect((call?.[1] as RequestInit | undefined)?.method).toBe("POST");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
