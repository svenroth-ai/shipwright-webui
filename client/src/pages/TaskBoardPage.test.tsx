import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/mocks/server";
import TaskBoardPage from "./TaskBoardPage";

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
});
