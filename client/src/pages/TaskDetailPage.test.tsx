/*
 * TaskDetailPage — Launch-Flow regression tests (iterate-2026-05-03 / ADR-067;
 * Transcript sub-tab retired iterate-2026-08-13-mission-mobile-visual — the
 * center pane is now unambiguously Terminal, so the old Toggle-Tab coverage
 * collapses to "terminal is always the rendered/active content").
 *
 * Covers:
 *   - LaunchCoordinator auto-launch focuses the terminal (ADR-068-A1).
 *   - Inbox-origin nav-state focuses the terminal.
 *   - Gitignore-suggestion toast lifecycle.
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
// Iterate-2026-05-04 (ADR-068-A1): TaskDetailHeader is mocked with a
// surface that exposes a Launch button which dispatches into the
// LaunchCoordinator via the real context. Tests can reach in to
// trigger an auto-launch without rendering the real header DOM.
vi.mock("../components/external/TaskDetailHeader", async () => {
  const { useLaunchCoordinator } = await import(
    "../contexts/LaunchCoordinatorContext"
  );
  return {
    TaskDetailHeader: () => {
      const coord = useLaunchCoordinator();
      return (
        <div data-testid="task-detail-header-mock">
          <button
            type="button"
            data-testid="task-detail-header-mock-launch"
            onClick={() =>
              coord.dispatchAutoLaunch(
                {
                  powershell: "& claude --launch ps",
                  cmd: "claude --launch cmd",
                  posix: "claude --launch posix",
                },
                false,
              )
            }
          >
            Launch
          </button>
        </div>
      );
    },
  };
});
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

function renderPage(
  navState?: { focusTerminal?: boolean },
): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[{ pathname: "/tasks/t-123", state: navState }]}
      >
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

  it("renders the terminal pane, mounted and active, plus the EmbeddedTerminal mock", async () => {
    renderPage();
    // React.lazy means the mock arrives async — wait.
    const terminal = await screen.findByTestId("embedded-terminal-mock");
    expect(terminal).toBeInTheDocument();
    expect(terminal.getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("task-detail-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-tab-transcript")).toBeNull();
  });

  it("flips to the Files & Terminal tab + calls .focus() when LaunchCoordinator dispatchAutoLaunch fires (ADR-068-A1)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("embedded-terminal-mock");
    focusSpy.mockClear();
    // Dispatch via the new LaunchCoordinator path (replaces the old
    // window.dispatchEvent("webui:launch-copied") flow).
    await user.click(screen.getByTestId("task-detail-header-mock-launch"));
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
  });

  // ---------- iterate-2026-05-18-inbox-terminal-prompts (Phase 1) ----------

  it("focuses the terminal when arriving from the Inbox (focusTerminal nav-state)", async () => {
    renderPage({ focusTerminal: true });
    await screen.findByTestId("embedded-terminal-mock");
    // The inbox-origin nav-state focuses xterm via the existing
    // pendingFocus → handleTerminalReady path.
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
  });

  it("does NOT focus the terminal on a non-Inbox open (AC2)", async () => {
    renderPage(); // no focusTerminal nav-state
    await screen.findByTestId("embedded-terminal-mock");
    // Let the EmbeddedTerminal mock's onReadyChange callback settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
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

  it("gitignore-suggestion toast STAYS OPEN with an error message when /append-gitignore returns non-OK (external review F9)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "gitignore_missing" }),
    }));
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
    await user.click(screen.getByTestId("gitignore-suggestion-append"));
    // Toast must stay open AND surface the structured error so the user
    // doesn't think the append succeeded silently.
    await waitFor(() => {
      expect(screen.getByTestId("gitignore-suggestion-toast")).toBeInTheDocument();
    });
    expect(screen.getByTestId("gitignore-suggestion-error")).toHaveTextContent(
      /gitignore_missing/,
    );
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
    expect(fetchMock.mock.calls.some((c: unknown[]) => String(c[0]).includes("/append-gitignore"))).toBe(false);
  });
});
