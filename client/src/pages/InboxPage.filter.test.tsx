/**
 * InboxPage — the filter chips (iterate-2026-11-22-w2-inbox-triage-look).
 * "Open" shows everything, "Awaiting reply" / "Notices" narrow the list, a chip
 * is a pressed-state toggle, and a kind with no entries offers no chip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import InboxPage from "./InboxPage";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";
import {
  makeAskItem,
  makeCodexErrorItem,
  makeProject,
  makeTask,
} from "./inbox/__fixtures__/inbox-fixtures";

vi.mock("../hooks/useExternalInbox", () => ({ useExternalInbox: vi.fn() }));
vi.mock("../hooks/useExternalTasks", () => ({ useExternalTasks: vi.fn() }));
vi.mock("../hooks/useProjects", () => ({ useProjects: vi.fn() }));

const mockedInbox = vi.mocked(useExternalInbox);
const mockedTasks = vi.mocked(useExternalTasks);
const mockedProjects = vi.mocked(useProjects);

function wire(withNotice: boolean) {
  const items = [makeAskItem({ taskId: "task-A", sessionUuid: "sess-A", toolUseId: "tu-A" })];
  if (withNotice) items.push(makeCodexErrorItem({ taskId: "task-B", sessionUuid: "sess-B" }) as never);
  mockedInbox.mockReturnValue({ data: items, isLoading: false } as unknown as ReturnType<typeof useExternalInbox>);
  mockedTasks.mockReturnValue({
    data: [
      makeTask({ taskId: "task-A", sessionUuid: "sess-A", projectId: "proj-a" }),
      makeTask({ taskId: "task-B", sessionUuid: "sess-B", projectId: "proj-a" }),
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useExternalTasks>);
  mockedProjects.mockReturnValue({
    data: [makeProject({ id: "proj-a", name: "Project A" })],
    isLoading: false,
  } as unknown as ReturnType<typeof useProjects>);
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// @covers FR-01.04
describe("InboxPage — filter chips", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.clearAllMocks());

  it("shows a count per chip and filters the rows; a second click on the active chip shows all again", () => {
    wire(true);
    renderPage();
    expect(screen.getByTestId("inbox-filter-all")).toHaveTextContent("2 Open");
    expect(screen.getByTestId("inbox-filter-awaiting")).toHaveTextContent("1 Awaiting reply");
    expect(screen.getByTestId("inbox-filter-notices")).toHaveTextContent("1 Notices");
    expect(screen.getByTestId("inbox-filter-all")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("inbox-filter-notices"));
    expect(screen.getByTestId("inbox-filter-notices")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("inbox-card-tu-A")).not.toBeInTheDocument();
    expect(screen.getByTestId("inbox-card-ce-task-B")).toBeInTheDocument();
    // The group header count follows the filter; the page header keeps the total.
    expect(screen.getByTestId("inbox-group-count-proj-a")).toHaveTextContent("1");
    expect(screen.getByTestId("inbox-header-count")).toHaveTextContent("2 open");

    fireEvent.click(screen.getByTestId("inbox-filter-notices"));
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-card-ce-task-B")).toBeInTheDocument();
  });

  it("a kind with no entries has no chip", () => {
    wire(false);
    renderPage();
    expect(screen.getByTestId("inbox-filter-awaiting")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-filter-notices")).not.toBeInTheDocument();
  });

  it("falls back to all when the active filter's last entry leaves", () => {
    wire(true);
    const { rerender } = renderPage();
    fireEvent.click(screen.getByTestId("inbox-filter-notices"));
    wire(false);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <InboxPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-filter-all")).toHaveAttribute("aria-pressed", "true");
  });
});
