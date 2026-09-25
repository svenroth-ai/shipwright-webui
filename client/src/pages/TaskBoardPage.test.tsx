import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/mocks/server";
import TaskBoardPage from "./TaskBoardPage";
import { useOrgChartPresence } from "../hooks/useOrgChartPresence";

vi.mock("../hooks/useOrgChartPresence");
const mockedOrgChartPresence = vi.mocked(useOrgChartPresence);

/*
 * TaskBoardPage — first test file for this page (FR-01.01 triage
 * trg-0f040744 finding 1). Focused on the one behaviour that had zero
 * coverage: a failed `/api/external/tasks` load must render a distinct
 * error+retry state, never the "No tasks yet" onboarding empty state
 * a genuinely-empty successful response gets.
 */

const ACTIONS_RESPONSE = {
  actions: [],
  phases: [],
  defaults: { autonomy: "guided" },
  preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
  diagnostics: [],
};

beforeEach(() => {
  server.use(
    http.get("/api/external/projects/:id/actions", () => HttpResponse.json(ACTIONS_RESPONSE)),
    http.get("/api/external/projects/:id/run-config", () => HttpResponse.json({ status: "missing" })),
  );
  mockedOrgChartPresence.mockReturnValue("present");
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <TaskBoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskBoardPage", () => {
  // @covers FR-01.01
  it("renders the A07 teaching empty state on a genuinely empty successful response", async () => {
    server.use(http.get("/api/external/tasks", () => HttpResponse.json({ tasks: [] })));
    renderPage();
    expect(await screen.findByTestId("task-board-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("task-board-load-error")).toBeNull();
  });

  // @covers FR-01.01 — trg-0f040744 finding 1: "broken" and "nothing here"
  // must not look identical.
  it("renders a distinct load-error state (not the onboarding empty state) when the tasks fetch fails", async () => {
    server.use(http.get("/api/external/tasks", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    renderPage();

    expect(await screen.findByTestId("task-board-load-error")).toBeInTheDocument();
    expect(screen.queryByTestId("task-board-empty")).toBeNull();
    expect(screen.queryByText(/no tasks yet/i)).toBeNull();
  });

  // @covers FR-01.01
  it("retry re-fetches and recovers once the endpoint starts responding", async () => {
    let failing = true;
    server.use(
      http.get("/api/external/tasks", () =>
        failing
          ? HttpResponse.json({ error: "boom" }, { status: 500 })
          : HttpResponse.json({ tasks: [] }),
      ),
    );
    renderPage();
    const retryButton = await screen.findByTestId("task-board-load-error-retry");

    failing = false;
    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByTestId("task-board-load-error")).toBeNull();
    });
    expect(await screen.findByTestId("task-board-empty")).toBeInTheDocument();
  });

  // @covers FR-04.22 — external plan review finding
  // (iterate-2026-09-26-runtime-badge-and-leads-gate): the Claim filter
  // toggle disappears on a confirmed absent org-chart presence, but its own
  // filter state must not silently keep applying with no visible control
  // left to turn it off.
  it("clears an already-active claim filter the moment org-chart presence resolves to absent, instead of leaving it stuck", async () => {
    server.use(
      http.get("/api/external/tasks", () =>
        HttpResponse.json({
          tasks: [
            {
              taskId: "t-claimed",
              sessionUuid: "11111111-1111-1111-1111-111111111111",
              title: "Claimed task",
              cwd: "/tmp/p",
              pluginDirs: [],
              projectId: "p1",
              state: "draft",
              createdAt: "2026-04-23T15:00:00Z",
              claimedBy: "po",
              inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
            },
            {
              taskId: "t-unclaimed",
              sessionUuid: "22222222-2222-2222-2222-222222222222",
              title: "Unclaimed task",
              cwd: "/tmp/p",
              pluginDirs: [],
              projectId: "p1",
              state: "draft",
              createdAt: "2026-04-23T15:00:00Z",
              inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
            },
          ],
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <TaskBoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByTestId("board-claim-filter-toggle");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Filtered: only the claimed task's card remains.
    expect(screen.getByText("Claimed task")).toBeInTheDocument();
    expect(screen.queryByText("Unclaimed task")).toBeNull();

    // Org-chart presence resolves to absent (e.g. Leadwright uninstalled
    // mid-session) — the toggle vanishes AND the filter itself clears, so
    // the board falls back to showing every task rather than staying stuck
    // on an invisible filter. Same QueryClient across the rerender — only
    // the mocked presence value changes, so the already-fetched task list
    // and the local claimFilter state are undisturbed by anything but the
    // effect under test.
    mockedOrgChartPresence.mockReturnValue("absent");
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <TaskBoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("board-claim-filter-toggle")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText("Unclaimed task")).toBeInTheDocument();
    });
    expect(screen.getByText("Claimed task")).toBeInTheDocument();
  });
});
