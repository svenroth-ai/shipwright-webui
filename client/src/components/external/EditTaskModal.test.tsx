/*
 * EditTaskModal — unit coverage. iterate-2026-05-18-edit-task-dialog.
 *
 * The two hooks the modal depends on (`useProjectActions`, `useUpdateTask`)
 * are mocked so the test is deterministic and offline; the modal's own
 * lifecycle-gating + diff logic is what is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EditTaskModal } from "./EditTaskModal";
import { ApiError } from "../../lib/externalApi";
import type { ExternalTask } from "../../lib/externalApi";
import type { ResolvedProjectActions } from "../../lib/externalApi";

vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: vi.fn(),
}));
vi.mock("../../hooks/useExternalTasks", () => ({
  useUpdateTask: vi.fn(),
}));

import { useProjectActions } from "../../hooks/useProjectActions";
import { useUpdateTask } from "../../hooks/useExternalTasks";

const ALL_FIELDS = [
  "title",
  "phase",
  "description",
  "domain",
  "priority",
  "complexityHint",
  "tags",
  "blockedBy",
];

const ACTIONS: ResolvedProjectActions = {
  actions: [
    { id: "new-task", label: "New task", kind: "external_launch", modal_fields: ALL_FIELDS },
    { id: "new-plain", label: "Plain Claude", kind: "external_launch", modal_fields: ["title", "description"] },
  ],
  phases: [
    { id: "build", label: "Build" },
    { id: "plan", label: "Plan" },
  ],
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

describe("EditTaskModal — never-started task (AC-1)", () => {
  it("renders every field as an editable input", () => {
    renderModal(baseTask());
    expect(screen.getByTestId("edit-task-title-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-description-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-phase-select")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-priority-select")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-complexity-select")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-domain-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-tags-input")).toBeInTheDocument();
    // No read-only displays on a never-started task.
    expect(screen.queryByTestId("edit-task-readonly-description")).toBeNull();
  });

  it("seeds the inputs from the task", () => {
    renderModal(baseTask({ description: "the brief", priority: "P2", domain: "auth" }));
    expect(screen.getByTestId("edit-task-title-input")).toHaveValue("Edit me");
    expect(screen.getByTestId("edit-task-description-input")).toHaveValue("the brief");
    expect(screen.getByTestId("edit-task-priority-select")).toHaveValue("P2");
    expect(screen.getByTestId("edit-task-domain-input")).toHaveValue("auth");
  });

  it("saves only the changed fields (a diff)", async () => {
    const user = userEvent.setup();
    renderModal(baseTask({ domain: "old" }));
    const domain = screen.getByTestId("edit-task-domain-input");
    await user.clear(domain);
    await user.type(domain, "billing");
    await user.click(screen.getByTestId("edit-task-save"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      taskId: "task-1",
      patch: { domain: "billing" },
    });
  });

  it("an empty diff closes the dialog without a PATCH", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderModal(baseTask());
    await user.click(screen.getByTestId("edit-task-save"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("blocks save when the title is cleared", async () => {
    const user = userEvent.setup();
    renderModal(baseTask());
    await user.clear(screen.getByTestId("edit-task-title-input"));
    await user.click(screen.getByTestId("edit-task-save"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("edit-task-error")).toHaveTextContent(/title/i);
  });
});

describe("EditTaskModal — started task (AC-2)", () => {
  it("renders launch-shaping fields read-only, metadata still editable", () => {
    renderModal(baseTask({ state: "active", description: "frozen brief", priority: "P1" }));
    // Frozen → read-only displays, no inputs.
    expect(screen.getByTestId("edit-task-readonly-description")).toHaveTextContent(
      "frozen brief",
    );
    expect(screen.getByTestId("edit-task-readonly-priority")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-task-description-input")).toBeNull();
    expect(screen.queryByTestId("edit-task-priority-select")).toBeNull();
    // Metadata → still editable.
    expect(screen.getByTestId("edit-task-domain-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-tags-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-title-input")).toBeInTheDocument();
  });

  it("a draft with launchedAt counts as started (frozen)", () => {
    renderModal(baseTask({ state: "draft", launchedAt: "2026-05-18T11:00:00Z" }));
    expect(screen.getByTestId("edit-task-readonly-description")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-task-description-input")).toBeNull();
  });
});

describe("EditTaskModal — modal_fields gating (AC-6)", () => {
  it("a new-plain task shows no Phase field", () => {
    renderModal(baseTask({ actionId: "new-plain" }));
    expect(screen.getByTestId("edit-task-title-input")).toBeInTheDocument();
    expect(screen.getByTestId("edit-task-description-input")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-task-phase-select")).toBeNull();
    expect(screen.queryByTestId("edit-task-priority-select")).toBeNull();
  });
});

describe("EditTaskModal — stale-dialog 409 (external review)", () => {
  it("shows an error and invalidates queries when the server rejects a frozen field", async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValueOnce(
      new ApiError("field_not_editable", 409, {
        error: "field_not_editable",
        fields: ["description"],
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <EditTaskModal
          open
          onOpenChange={vi.fn()}
          task={baseTask({ description: "old" })}
        />
      </QueryClientProvider>,
    );
    const desc = screen.getByTestId("edit-task-description-input");
    await user.clear(desc);
    await user.type(desc, "new brief");
    await user.click(screen.getByTestId("edit-task-save"));
    expect(await screen.findByTestId("edit-task-error")).toHaveTextContent(
      /started/i,
    );
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe("EditTaskModal — catalog loading", () => {
  it("shows a loading placeholder while the actions catalog resolves", () => {
    vi.mocked(useProjectActions).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useProjectActions>);
    renderModal(baseTask());
    expect(screen.getByTestId("edit-task-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-task-modal-form")).toBeNull();
  });
});
