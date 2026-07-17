/*
 * TaskDetailPage — the A19 (FR-01.63) terminal-fallback deep link.
 *
 * The Inbox CTA navigates here via `?pane=terminal&focus=terminal` (built in
 * lib/taskDeepLink.ts). TaskDetail must read that intent, select the Files &
 * Terminal pane + Terminal segment, focus the terminal via the SAME pendingFocus
 * path the card-click nav-state uses, and strip the query so a reload does not
 * re-snap. This is the unit cover for that effect (the full browser flow is
 * flows/inbox-terminal-fallback.spec.ts). Kept in its own file so the grandfathered
 * TaskDetailPage.test.tsx bloat baseline is not ratcheted.
 *
 * EmbeddedTerminal is mocked: jsdom can't render xterm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { forwardRef, useEffect, useImperativeHandle } from "react";

vi.mock("../hooks/useExternalTasks", () => ({ useExternalTask: vi.fn() }));
vi.mock("../hooks/useTaskTranscript", () => ({ useTaskTranscript: vi.fn() }));
vi.mock("../components/external/BubbleTranscript", () => ({
  BubbleTranscript: () => <div data-testid="bubble-transcript-mock" />,
}));
vi.mock("../components/external/TaskDetailHeader", () => ({
  TaskDetailHeader: () => <div data-testid="task-detail-header-mock" />,
}));
vi.mock("../components/external/TaskDetailThreePane", () => ({
  TaskDetailThreePane: ({ center }: { center: React.ReactNode }) => (
    <div data-testid="three-pane-mock">{center}</div>
  ),
}));
vi.mock("../components/external/FolderTree", () => ({
  FolderTree: () => <div data-testid="folder-tree-mock" />,
}));
vi.mock("../components/external/SmartViewer", () => ({
  SmartViewer: () => <div data-testid="smart-viewer-mock" />,
}));
vi.mock("../components/external/SmartViewer/ViewerTabBar", () => ({
  ViewerTabBar: () => <div data-testid="viewer-tab-bar-mock" />,
}));

const focusSpy = vi.fn();
vi.mock("../components/terminal/EmbeddedTerminal", () => {
  const Mock = forwardRef<
    { focus: () => void; ready: boolean },
    { taskId: string; active: boolean; onReadyChange?: (r: boolean, role: "writer" | "reader" | null) => void }
  >(function EmbeddedTerminalMock(props, ref) {
    useImperativeHandle(ref, () => ({ focus: focusSpy, ready: true }), []);
    useEffect(() => {
      props.onReadyChange?.(true, "writer");
    }, [props.onReadyChange]);
    return <div data-testid="embedded-terminal-mock" data-active={props.active ? "true" : "false"} />;
  });
  return { EmbeddedTerminal: Mock };
});

import TaskDetailPage from "./TaskDetailPage";
import { useExternalTask } from "../hooks/useExternalTasks";
import { useTaskTranscript } from "../hooks/useTaskTranscript";

const mockTask = {
  taskId: "t-123",
  sessionUuid: "uuid-123",
  title: "Demo task",
  state: "draft",
  cwd: "C:\\demo",
  createdAt: "2026-05-03T00:00:00.000Z",
  projectId: "p-1",
  schemaVersion: 3,
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-probe" data-search={loc.search} />;
}

function renderAt(entry: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/tasks/:taskId"
            element={
              <>
                <TaskDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskDetailPage — A19 terminal-fallback deep link", () => {
  beforeEach(() => {
    (useExternalTask as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockTask,
      error: null,
    });
    (useTaskTranscript as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      content: "",
      status: "ok",
    });
    localStorage.clear();
    focusSpy.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("selects the Terminal segment and focuses the terminal on ?focus=terminal", async () => {
    renderAt("/tasks/t-123?pane=terminal&focus=terminal");
    await screen.findByTestId("embedded-terminal-mock");
    await waitFor(() =>
      expect(
        screen.getByTestId("task-detail-terminal").getAttribute("data-state"),
      ).toBe("active"),
    );
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
  });

  it("strips the query so a reload does not re-snap focus", async () => {
    renderAt("/tasks/t-123?pane=terminal&focus=terminal");
    await screen.findByTestId("embedded-terminal-mock");
    await waitFor(() =>
      expect(screen.getByTestId("loc-probe").getAttribute("data-search")).toBe(""),
    );
  });

  it("does NOT focus the terminal without the deep-link intent", async () => {
    renderAt("/tasks/t-123");
    await screen.findByTestId("embedded-terminal-mock");
    await new Promise((r) => setTimeout(r, 0));
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
