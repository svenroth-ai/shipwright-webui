/*
 * EditTaskModal — Codex Light §3.5 runtime-aware hint copy, wired in
 * EditTaskModalFields.tsx (Description hint + AutonomyToggle overrides).
 * New file rather than an addition to EditTaskModal.runtime-toggle.test.tsx
 * — same 300-line-ceiling convention as that file and
 * EditTaskModal.autonomy-catalog-fallback.test.tsx. Fixtures below add a
 * `build` phase with `supports_autonomy: true` and a `description` modal
 * field so both the Autonomy toggle and Description hint render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    {
      id: "new-task",
      label: "New task",
      kind: "external_launch",
      modal_fields: ["title", "description"],
    },
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
    phase: "build",
    state: "draft",
    createdAt: "2026-05-18T10:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useUpdateTask).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTask>);
  vi.mocked(useProjectActions).mockReturnValue({
    data: ACTIONS,
    isLoading: false,
  } as unknown as ReturnType<typeof useProjectActions>);
});

function renderModal(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditTaskModal open onOpenChange={vi.fn()} task={task} />
    </QueryClientProvider>,
  );
}

describe("EditTaskModal — Codex Light §3.5 runtime-aware hint copy", () => {
  it("Description hint names Claude for a Claude-runtime task", () => {
    renderModal(baseTask({ runtime: "claude" }));
    expect(screen.getByText(/the first prompt Claude sees/)).toBeInTheDocument();
  });

  it("Description hint names Codex for a Codex-runtime task", () => {
    renderModal(baseTask({ runtime: "codex" }));
    expect(screen.getByText(/the first prompt Codex sees/)).toBeInTheDocument();
  });

  it("Autonomy hint shows the default Claude/AskUser copy for a Claude-runtime task", () => {
    renderModal(baseTask({ runtime: "claude" }));
    expect(screen.getByText(/Claude pauses at every AskUser/)).toBeInTheDocument();
  });

  it("Autonomy hint shows Codex-accurate copy for a Codex-runtime task", () => {
    renderModal(baseTask({ runtime: "codex" }));
    expect(
      screen.getByText(/Codex asks before it acts or when it needs your input/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Claude pauses at every AskUser/)).not.toBeInTheDocument();
  });
});
