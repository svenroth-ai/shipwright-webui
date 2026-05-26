/*
 * InboxResumeButton — extraction contract test (C7 — 2026-05-26).
 *
 * Covers external-plan-review MEDIUM finding #6 (error-path preservation):
 *  - mutateAsync({ taskId, resume: true }) shape preserved.
 *  - Platform-appropriate command selected (powershell on Windows UA).
 *  - clipboard write_failure path renders error span.
 *  - mutateAsync reject path renders error span.
 *  - e.stopPropagation called so card-level nav does NOT fire.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../hooks/useLaunchTask", () => ({
  useLaunchTask: vi.fn(),
}));

import { useLaunchTask } from "../../hooks/useLaunchTask";
import { InboxResumeButton } from "./InboxResumeButton";
import type { ExternalTask } from "../../lib/externalApi";

const mockedLaunch = vi.mocked(useLaunchTask);

function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-A",
    sessionUuid: "sess-A",
    cwd: "/tmp",
    pluginDirs: [],
    title: "task-A",
    projectId: "proj-a",
    state: "active",
    createdAt: "2026-04-20T00:00:00Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    ...overrides,
  };
}

function renderBtn(task: ExternalTask, toolUseId = "tu-A") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InboxResumeButton task={task} toolUseId={toolUseId} />
    </QueryClientProvider>,
  );
}

describe("InboxResumeButton — extraction contract", () => {
  beforeEach(() => {
    mockedLaunch.mockReset();
    // Reset the userAgent mock between tests.
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0",
      configurable: true,
    });
  });

  it("click calls useLaunchTask.mutateAsync with { taskId, resume: true }", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: { posix: "claude --resume xyz", powershell: "claude --resume xyz" },
    });
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        taskId: "task-A",
        resume: true,
      }),
    );
  });

  it("selects posix command on non-Windows UA", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: { posix: "POSIX_CMD", powershell: "PS_CMD" },
    });
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("POSIX_CMD"));
  });

  it("selects powershell command on Windows UA", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0)",
      configurable: true,
    });
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: { posix: "POSIX_CMD", powershell: "PS_CMD" },
    });
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("PS_CMD"));
  });

  it("clipboard.writeText rejection surfaces an error span (code-review MED)", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: { posix: "POSIX_CMD", powershell: "PS_CMD" },
    });
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);
    // Clipboard exists but rejects — exercises the writeClipboardModule
    // success path's await rejection, NOT the fallback textarea path.
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")),
      },
    });

    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    const err = await screen.findByRole("alert");
    expect(err.textContent).toContain("clipboard blocked");
  });

  it("mutateAsync rejection surfaces an error span", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("backend exploded"));
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);

    renderBtn(makeTask());
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    const err = await screen.findByRole("alert");
    expect(err.textContent).toContain("backend exploded");
  });

  it("e.stopPropagation prevents card-level click propagation", () => {
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({
        commands: { posix: "x", powershell: "x" },
      }),
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);

    const cardClick = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <div onClick={cardClick} data-testid="card">
          <InboxResumeButton task={makeTask()} toolUseId="tu-A" />
        </div>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    // The card's onClick must NOT have fired (stopPropagation).
    expect(cardClick).not.toHaveBeenCalled();
  });

  it("legacy testid inbox-copy-resume-<toolUseId> retained for back-compat", () => {
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useLaunchTask>);

    renderBtn(makeTask());
    expect(screen.getByTestId("inbox-copy-resume-tu-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-resume-tu-A")).toBeInTheDocument();
  });

  it("isPending=true disables the button and shows Preparing…", () => {
    mockedLaunch.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: true,
    } as unknown as ReturnType<typeof useLaunchTask>);

    renderBtn(makeTask());
    const btn = screen.getByTestId("inbox-resume-tu-A");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain("Preparing");
  });
});
