/*
 * TaskDetailPage — Toggle-Tab + Launch-Flow regression tests
 * (iterate-2026-05-03 / ADR-067).
 *
 * Covers:
 *   - Tab switch via webui:launch-copied event flips center pane to terminal.
 *   - localStorage persists the chosen tab across mounts.
 *   - Both Tabs.Content panes mount + stay mounted across toggle (forceMount
 *     guarantee — closes external review F3 / Radix-unmount trap).
 *   - Other testids (3-pane shell, transcript stats) survive the rebuild.
 *
 * EmbeddedTerminal is mocked: jsdom can't render xterm. The mock surface
 * mirrors the real component's testid + onReadyChange callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { forwardRef, useEffect, useImperativeHandle } from "react";

vi.mock("../hooks/useExternalTasks", () => ({
  useExternalTask: vi.fn(),
}));
vi.mock("../hooks/useTaskTranscript", () => ({
  useTaskTranscript: vi.fn(),
}));
vi.mock("../components/external/BubbleTranscript", () => ({
  BubbleTranscript: () => <div data-testid="bubble-transcript-mock" />,
}));
vi.mock("../components/external/TaskDetailHeader", () => ({
  TaskDetailHeader: () => <div data-testid="task-detail-header-mock" />,
}));
vi.mock("../components/external/TaskDetailThreePane", () => ({
  TaskDetailThreePane: ({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="three-pane-mock">
      <div data-testid="three-pane-left">{left}</div>
      <div data-testid="three-pane-center">{center}</div>
      <div data-testid="three-pane-right">{right}</div>
    </div>
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

// Track ready callback invocations for the EmbeddedTerminal mock.
const focusSpy = vi.fn();
const mountCounterRef = { current: 0 };
const gitignoreSuggestionRef: { current: (() => void) | null } = { current: null };

vi.mock("../components/terminal/EmbeddedTerminal", () => {
  const Mock = forwardRef<
    { focus: () => void; ready: boolean },
    {
      taskId: string;
      active: boolean;
      onReadyChange?: (r: boolean, role: "writer" | "reader" | null) => void;
      onGitignoreSuggestion?: () => void;
    }
  >(function EmbeddedTerminalMock(props, ref) {
    useImperativeHandle(ref, () => ({ focus: focusSpy, ready: true }), []);
    useEffect(() => {
      mountCounterRef.current += 1;
    }, []);
    useEffect(() => {
      props.onReadyChange?.(true, "writer");
    }, [props.onReadyChange]);
    useEffect(() => {
      gitignoreSuggestionRef.current = props.onGitignoreSuggestion ?? null;
    }, [props.onGitignoreSuggestion]);
    return (
      <div
        data-testid="embedded-terminal-mock"
        data-active={props.active ? "true" : "false"}
        data-task-id={props.taskId}
      />
    );
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

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/tasks/t-123"]}>
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskDetailPage — Toggle-Tab + Launch-Flow", () => {
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
    mountCounterRef.current = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders both Tabs (Transcript + Terminal) plus the EmbeddedTerminal mock", async () => {
    renderPage();
    expect(screen.getByTestId("task-detail-tab-transcript")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-tab-terminal")).toBeInTheDocument();
    // React.lazy means the mock arrives async — wait.
    expect(await screen.findByTestId("embedded-terminal-mock")).toBeInTheDocument();
  });

  it("default tab is Terminal (initial-default per plan §User-Entscheidungen)", async () => {
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    const terminalPane = screen.getByTestId("task-detail-terminal");
    expect(terminalPane.getAttribute("data-state")).toBe("active");
  });

  it("forceMount keeps BOTH Tabs.Content rendered across toggle (no remount)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    expect(screen.getByTestId("task-detail-transcript")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-terminal")).toBeInTheDocument();

    const earlyMounts = mountCounterRef.current;
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    expect(screen.getByTestId("task-detail-transcript")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-terminal-mock")).toBeInTheDocument();
    await user.click(screen.getByTestId("task-detail-tab-terminal"));
    // Mount counter must NOT increment per toggle — that's the regression
    // fence for external review F3 (Radix-unmount trap).
    expect(mountCounterRef.current).toBe(earlyMounts);
  });

  it("persists the chosen tab to localStorage and restores it on next mount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(localStorage.getItem("webui:embedded-terminal-default-tab")).toBe(
        '"transcript"',
      ),
    );
    unmount();
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    const transcriptPane = screen.getByTestId("task-detail-transcript");
    expect(transcriptPane.getAttribute("data-state")).toBe("active");
  });

  it("flips to terminal + calls .focus() when webui:launch-copied event fires for THIS task", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    // Start from transcript so the flip is observable.
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(screen.getByTestId("task-detail-transcript").getAttribute("data-state")).toBe(
        "active",
      ),
    );
    focusSpy.mockClear();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("webui:launch-copied", { detail: { taskId: "t-123" } }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("task-detail-terminal").getAttribute("data-state")).toBe(
        "active",
      ),
    );
    // The mock surfaces ready=true via onReadyChange on mount. The
    // readiness handshake then calls focus when pendingFocus is set —
    // i.e. once the launch-copied event has been received.
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
  });

  it("ignores webui:launch-copied for OTHER tasks (no spurious flip)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(screen.getByTestId("task-detail-transcript").getAttribute("data-state")).toBe(
        "active",
      ),
    );
    focusSpy.mockClear();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("webui:launch-copied", { detail: { taskId: "different-task" } }),
      );
    });
    expect(screen.getByTestId("task-detail-transcript").getAttribute("data-state")).toBe(
      "active",
    );
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("gitignore-suggestion toast surfaces on EmbeddedTerminal callback; Append calls /append-gitignore", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    expect(screen.queryByTestId("gitignore-suggestion-toast")).toBeNull();
    // Trigger the toast via the recorded callback (simulates server returning
    // gitignoreSuggestion=true on a paste-image response).
    await act(async () => {
      gitignoreSuggestionRef.current?.();
    });
    expect(screen.getByTestId("gitignore-suggestion-toast")).toBeInTheDocument();
    await user.click(screen.getByTestId("gitignore-suggestion-append"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/terminal/t-123/append-gitignore",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("gitignore-suggestion-toast")).toBeNull();
    });
  });

  it("gitignore-suggestion toast Dismiss closes without calling /append-gitignore", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    await act(async () => {
      gitignoreSuggestionRef.current?.();
    });
    await user.click(screen.getByTestId("gitignore-suggestion-dismiss"));
    expect(screen.queryByTestId("gitignore-suggestion-toast")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transcript stats only render when transcript tab is active (avoids stale numbers in terminal-mode header)", async () => {
    const user = userEvent.setup();
    (useTaskTranscript as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      content: '{"type":"summary","summary":"x"}\n',
      status: "ok",
    });
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    // Default = terminal — stats hidden.
    expect(screen.queryByTestId("transcript-stat-events")).toBeNull();
    await user.click(screen.getByTestId("task-detail-tab-transcript"));
    await waitFor(() =>
      expect(screen.queryByTestId("transcript-stat-events")).not.toBeNull(),
    );
  });
});
