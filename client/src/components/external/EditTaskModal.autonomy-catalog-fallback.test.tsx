/*
 * EditTaskModal — Autonomy toggle survives a stale/missing catalog action
 * (code-review finding, iterate-2026-08-16-task-lifecycle-ux-fixes).
 *
 * `useEditTaskForm.ts` resolves `mode` via `resolveMode(action ?? ...)`,
 * where `action` is the task's `actionId` looked up in the LOADED catalog.
 * If that lookup misses (a stale/renamed/removed action id — the catalog
 * can legitimately drift from a task's `actionId` over the task's
 * lifetime), `mode` used to fall back to `null`, which `resolveMode`
 * degrades to `"new-task"` — silently hiding Autonomy for a pipeline/
 * iterate task, since `showAutonomyToggle`'s `new-task` branch gates on a
 * phase's `supports_autonomy` instead of being unconditionally true.
 *
 * New file rather than an addition to EditTaskModal.test.tsx: that file
 * sits at 296/300 lines, and this test's own fixture setup would push it
 * over (same reasoning as EditTaskModal.reopen-rearm.test.tsx and friends
 * elsewhere in this codebase — see CLAUDE.md's sibling-test-file
 * convention). Fixtures below are a minimal, self-contained subset of the
 * main suite's.
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

// The catalog does NOT contain a "new-pipeline" action — models a task
// whose actionId has drifted out of sync with the currently-loaded
// project actions (stale catalog / renamed / removed action).
const ACTIONS_MISSING_PIPELINE: ResolvedProjectActions = {
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
    actionId: "new-pipeline",
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
    data: ACTIONS_MISSING_PIPELINE,
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

describe("EditTaskModal — Autonomy toggle survives a catalog-miss", () => {
  it("still shows the toggle for a pipeline-mode task whose actionId is not in the loaded catalog", () => {
    renderModal(baseTask());
    expect(screen.getByTestId("autonomy-toggle")).toBeInTheDocument();
  });
});
