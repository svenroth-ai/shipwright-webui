/*
 * TaskDetailPage transcript-stats characterization
 * (iterate-2026-07-23-transcript-incremental-render). Pins the behaviour the
 * incremental refactor must preserve: an EMPTY transcript forces the header's
 * `pending` count to 0 even when the task's inbox has pending tool-uses — the
 * pre-refactor guard external review flagged as dropped, now restored.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../hooks/useExternalTasks", () => ({ useExternalTask: vi.fn() }));
vi.mock("../hooks/useTaskTranscript", () => ({ useTaskTranscript: vi.fn() }));
vi.mock("../components/external/BubbleTranscript", () => ({
  BubbleTranscript: () => <div data-testid="bubble-transcript-mock" />,
}));
vi.mock("../components/external/TaskDetailHeader", () => ({
  TaskDetailHeader: () => <div data-testid="task-detail-header-mock" />,
}));
vi.mock("../components/external/TaskDetailThreePane", () => ({
  TaskDetailThreePane: ({ center }: { center: React.ReactNode }) => <div>{center}</div>,
}));
vi.mock("../components/external/FolderTree", () => ({ FolderTree: () => null }));
vi.mock("../components/external/SmartViewer", () => ({ SmartViewer: () => null }));
vi.mock("../components/external/SmartViewer/ViewerTabBar", () => ({ ViewerTabBar: () => null }));
vi.mock("../components/terminal/EmbeddedTerminal", () => ({
  EmbeddedTerminal: () => <div data-testid="embedded-terminal-mock" />,
}));

import TaskDetailPage from "./TaskDetailPage";
import { useExternalTask } from "../hooks/useExternalTasks";
import { useTaskTranscript } from "../hooks/useTaskTranscript";

const taskWithPending = {
  taskId: "t-1", sessionUuid: "u-1", title: "T", state: "running", cwd: "C:\\d",
  createdAt: "2026-07-23T00:00:00.000Z", projectId: "p-1", schemaVersion: 3,
  inbox: { pendingToolUseIds: ["a", "b"] },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/tasks/t-1"]}>
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskDetailPage transcript stats — empty-content pending guard", () => {
  beforeEach(() => {
    (useExternalTask as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: taskWithPending, error: null,
    });
    localStorage.clear();
  });
  afterEach(() => vi.clearAllMocks());

  it("shows 0 pending when the transcript is empty, even with a non-empty inbox", async () => {
    (useTaskTranscript as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ content: "", status: "ok" });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(screen.getByTestId("transcript-stat-pending")).toHaveTextContent("0 pending"),
    );
  });

  it("shows the inbox pending count once the transcript has content", async () => {
    (useTaskTranscript as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      content: '{"type":"user","message":{"content":"hi"}}\n', status: "ok",
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(screen.getByTestId("transcript-stat-pending")).toHaveTextContent("2 pending"),
    );
  });
});
