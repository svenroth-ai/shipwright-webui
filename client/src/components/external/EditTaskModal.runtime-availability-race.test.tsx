/*
 * EditTaskModal — `runtime` re-resolves when `codexAvailability` resolves
 * or changes while the modal is already open (local PR-review preflight
 * finding, iterate-2026-09-23; mirrors `useNewIssueFormState.ts`'s
 * identical fix for the create forms, 2026-09-16).
 *
 * Before this fix, `useEditTaskForm.ts` only re-seeded `runtime` on the
 * `open` false->true edge. A `useSettings()` query that resolves AFTER the
 * modal is already open (the common case — the modal usually opens before
 * the settings fetch lands) never re-ran that seed, so a never-started
 * task under restricted availability could display RuntimeToggle's forced
 * fixed pill while the underlying `runtime` state — and therefore the
 * submitted patch — still held the task's stale runtime.
 *
 * New file rather than an addition to EditTaskModal.test.tsx: that file is
 * already near the bloat ceiling and this fixture (mocking useSettings)
 * doesn't overlap with its existing setup — same sibling-test-file
 * convention as EditTaskModal.autonomy-catalog-fallback.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EditTaskModal } from "./EditTaskModal";
import type { ExternalTask } from "../../lib/externalApi";
import type { GlobalSettings } from "../../types";

vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: vi.fn(),
}));
vi.mock("../../hooks/useExternalTasks", () => ({
  useUpdateTask: vi.fn(),
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: vi.fn(),
}));

import { useProjectActions } from "../../hooks/useProjectActions";
import { useUpdateTask } from "../../hooks/useExternalTasks";
import { useSettings } from "../../hooks/useSettings";

function baseTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "11111111-1111-1111-1111-111111111111",
    title: "Edit me",
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p1",
    runtime: "claude",
    state: "draft",
    createdAt: "2026-05-18T10:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function settingsQuery(data: Partial<GlobalSettings> | undefined) {
  return { data } as unknown as ReturnType<typeof useSettings>;
}

let mutateAsync: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mutateAsync = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useUpdateTask).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateTask>);
  vi.mocked(useProjectActions).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useProjectActions>);
});

function renderModal(task: ExternalTask) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditTaskModal open onOpenChange={vi.fn()} task={task} />
    </QueryClientProvider>,
  );
}

describe("EditTaskModal — runtime re-resolves when settings resolve after open", () => {
  it("forces runtime to the restricted value once codexAvailability resolves, and submits it (not the task's stale runtime)", async () => {
    // Settings query still pending when the modal first mounts.
    vi.mocked(useSettings).mockReturnValue(settingsQuery(undefined));
    const task = baseTask({ runtime: "claude" });
    const { rerender } = renderModal(task);

    // Still unresolved -> default "both" -> interactive toggle, not forced.
    expect(screen.getByTestId("runtime-toggle")).toBeInTheDocument();

    // Settings resolve to codex_only WHILE the modal stays open.
    vi.mocked(useSettings).mockReturnValue(settingsQuery({ codexAvailability: "codex_only" }));
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditTaskModal open onOpenChange={vi.fn()} task={task} />
      </QueryClientProvider>,
    );

    const fixed = screen.getByTestId("runtime-toggle-fixed");
    expect(fixed).toHaveTextContent("Codex");

    fireEvent.submit(screen.getByTestId("edit-task-modal-form"));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        patch: expect.objectContaining({ runtime: "codex" }),
      }),
    );
  });

  it("a user's own interactive pick under 'both' availability is never clobbered by an unrelated re-render", async () => {
    vi.mocked(useSettings).mockReturnValue(settingsQuery({ codexAvailability: "both" }));
    const task = baseTask({ runtime: "claude" });
    renderModal(task);

    fireEvent.click(screen.getByTestId("runtime-codex"));
    expect(screen.getByTestId("runtime-codex")).toHaveAttribute("aria-checked", "true");

    fireEvent.submit(screen.getByTestId("edit-task-modal-form"));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        patch: expect.objectContaining({ runtime: "codex" }),
      }),
    );
  });
});
