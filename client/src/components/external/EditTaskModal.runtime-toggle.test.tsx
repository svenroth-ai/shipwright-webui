/*
 * EditTaskModal — Runtime toggle (Codex Light, Spec/codex-light-webui.md
 * §3.5). New file rather than an addition to EditTaskModal.test.tsx (that
 * file already sits at the 300-line ceiling — same convention as
 * EditTaskModal.autonomy-catalog-fallback.test.tsx). Fixtures below are a
 * minimal, self-contained subset of the main suite's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EditTaskModal } from "./EditTaskModal";
import type { ExternalTask, ResolvedProjectActions } from "../../lib/externalApi";

vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: vi.fn(),
}));
vi.mock("../../hooks/useExternalTasks", () => ({
  useUpdateTask: vi.fn(),
}));

import { useProjectActions } from "../../hooks/useProjectActions";
import { useUpdateTask } from "../../hooks/useExternalTasks";

const ACTIONS: ResolvedProjectActions = {
  actions: [
    { id: "new-task", label: "New task", kind: "external_launch", modal_fields: ["title"] },
  ],
  phases: [{ id: "build", label: "Build", supports_autonomy: true }],
  defaults: { autonomy: "guided" },
  preview: { enabled: false, command: null, port: null, ready_path: null, ready_timeout_seconds: null },
  diagnostics: [],
};

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Edit me",
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p1",
    actionId: "new-task",
    state: "draft",
    createdAt: "2026-05-18T10:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

const mutateAsync = vi.fn();

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(baseTask());
  vi.mocked(useUpdateTask).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTask>);
  vi.mocked(useProjectActions).mockReturnValue({
    data: ACTIONS,
    isLoading: false,
  } as unknown as ReturnType<typeof useProjectActions>);
});

function renderModal(task: ExternalTask, onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditTaskModal open onOpenChange={onOpenChange} task={task} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("EditTaskModal — Runtime toggle (Codex Light §3.5)", () => {
  it("shows the toggle on a never-started task, defaulting to Claude", () => {
    renderModal(baseTask());
    expect(screen.getByTestId("runtime-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-claude")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("switching to Codex and saving includes runtime in the patch diff", async () => {
    const user = userEvent.setup();
    renderModal(baseTask());
    await user.click(screen.getByTestId("runtime-codex"));
    await user.click(screen.getByTestId("edit-task-save"));
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: "task-1",
      patch: { runtime: "codex" },
    });
  });

  it("does not include runtime in the diff when left unchanged", async () => {
    const user = userEvent.setup();
    renderModal(baseTask({ runtime: "claude" }));
    await user.click(screen.getByTestId("edit-task-save"));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("on a started task, renders runtime read-only instead of the toggle", () => {
    renderModal(baseTask({ state: "active", runtime: "codex" }));
    expect(screen.queryByTestId("runtime-toggle")).toBeNull();
    expect(screen.getByTestId("edit-task-readonly-runtime")).toHaveTextContent(
      "Codex",
    );
  });
});
