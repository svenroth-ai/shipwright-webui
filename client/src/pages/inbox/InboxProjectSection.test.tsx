/*
 * InboxProjectSection — project-group rendering contract (C7 — 2026-05-26).
 *
 * Covers external-plan-review:
 *  - MED #3 (ordering preservation — sessions render in input order).
 *  - LOW #7 (<details open> keying — same projectId/sessionUuid keys).
 *
 * The existing InboxPage.test.tsx covers the integration path; this
 * isolates the section so the chevron-color chip + Unassigned bucket
 * branching are unit-tested directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useLaunchTask", () => ({
  useLaunchTask: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

import { InboxProjectSection } from "./InboxProjectSection";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import type { AskToolInboxItem, ExternalTask } from "../../lib/externalApi";
import type { Project } from "../../types";
import type { ProjectGroup, SessionGroup } from "./types";

function makeAsk(overrides: Partial<AskToolInboxItem> = {}): AskToolInboxItem {
  return {
    kind: "ask_tool",
    taskId: "task-A",
    sessionUuid: "sess-A",
    taskTitle: "task-A",
    toolUseId: "tu-A",
    toolName: "AskUserQuestion",
    input: { parts: [{ question: "x?" }] },
    bestEffort: true,
    ...overrides,
  };
}

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

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "proj-a",
    name: "Project A",
    path: "/tmp/proj-a",
    profile: "generic",
    status: "active",
    lastActive: "2026-04-20T00:00:00Z",
    createdAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function renderSection(group: ProjectGroup, tasksById: Map<string, ExternalTask>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InboxProjectSection group={group} tasksById={tasksById} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InboxProjectSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders project label + open-count chip + colour dot", () => {
    const session: SessionGroup = {
      sessionUuid: "sess-A",
      taskId: "task-A",
      taskTitle: "task-A",
      items: [makeAsk({ toolUseId: "tu-1" }), makeAsk({ toolUseId: "tu-2" })],
    };
    const group: ProjectGroup = {
      projectId: "proj-a",
      projectName: "Project A",
      project: makeProject({ id: "proj-a", name: "Project A" }),
      sessions: [session],
      totalItems: 2,
    };
    renderSection(group, new Map([["task-A", makeTask()]]));

    expect(screen.getByTestId("inbox-project-group-proj-a")).toBeInTheDocument();
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-group-count-proj-a")).toHaveTextContent("2");
    expect(screen.getByTestId("inbox-group-color-proj-a")).toBeInTheDocument();
  });

  it("Unassigned bucket uses the neutral white-tint accent (no project colour)", () => {
    const group: ProjectGroup = {
      projectId: UNASSIGNED_PROJECT_ID,
      projectName: "Unassigned",
      project: undefined,
      sessions: [
        {
          sessionUuid: "sess-X",
          taskId: "task-X",
          taskTitle: "task-X",
          items: [makeAsk({ toolUseId: "tu-X" })],
        },
      ],
      totalItems: 1,
    };
    renderSection(group, new Map());

    const chip = screen.getByTestId(`inbox-group-color-${UNASSIGNED_PROJECT_ID}`);
    expect(chip).toBeInTheDocument();
    // No project means no deterministic colour: the neutral white tint an unowned Triage lane uses.
    expect(chip.getAttribute("style") ?? "").toContain("rgba(255, 255, 255, 0.35)");
  });

  it("sessions render in input order (MED #3 — ordering preservation)", () => {
    const group: ProjectGroup = {
      projectId: "proj-a",
      projectName: "Project A",
      project: makeProject({ id: "proj-a", name: "Project A" }),
      sessions: [
        {
          sessionUuid: "sess-1",
          taskId: "task-1",
          taskTitle: "t1",
          items: [makeAsk({ toolUseId: "tu-1", sessionUuid: "sess-1", taskId: "task-1" })],
        },
        {
          sessionUuid: "sess-2",
          taskId: "task-2",
          taskTitle: "t2",
          items: [makeAsk({ toolUseId: "tu-2", sessionUuid: "sess-2", taskId: "task-2" })],
        },
        {
          sessionUuid: "sess-3",
          taskId: "task-3",
          taskTitle: "t3",
          items: [makeAsk({ toolUseId: "tu-3", sessionUuid: "sess-3", taskId: "task-3" })],
        },
      ],
      totalItems: 3,
    };
    const tasksById = new Map<string, ExternalTask>([
      ["task-1", makeTask({ taskId: "task-1" })],
      ["task-2", makeTask({ taskId: "task-2" })],
      ["task-3", makeTask({ taskId: "task-3" })],
    ]);
    renderSection(group, tasksById);

    const sessions = [
      screen.getByTestId("inbox-session-sess-1"),
      screen.getByTestId("inbox-session-sess-2"),
      screen.getByTestId("inbox-session-sess-3"),
    ];
    // Verify DOM order matches input order via compareDocumentPosition.
    expect(
      sessions[0]!.compareDocumentPosition(sessions[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sessions[1]!.compareDocumentPosition(sessions[2]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});


describe("InboxProjectSection — fold + reorder handle (iterate-2026-11-13-inbox-triage-look)", () => {
  const SESS = "3f9a1c42-aaaa-bbbb-cccc-000000000000";

  function oneGroup(): [ProjectGroup, Map<string, ExternalTask>] {
    const group: ProjectGroup = {
      projectId: "proj-a",
      projectName: "Project A",
      project: makeProject({ id: "proj-a", name: "Project A" }),
      sessions: [
        {
          sessionUuid: SESS,
          taskId: "task-A",
          taskTitle: "task-A",
          items: [makeAsk({ toolUseId: "tu-1", sessionUuid: SESS })],
        },
      ],
      totalItems: 1,
    };
    return [group, new Map([["task-A", makeTask()]])];
  }

  function renderWith(props: Partial<React.ComponentProps<typeof InboxProjectSection>>) {
    const [group, tasks] = oneGroup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InboxProjectSection group={group} tasksById={tasks} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("an expanded group shows its cards and each card carries its session chip", () => {
    renderWith({ isCollapsed: false });
    expect(screen.getByTestId("inbox-card-tu-1")).toBeInTheDocument();
    expect(screen.getByTestId(`inbox-group-project-label-${SESS}-tu-1`)).toHaveTextContent("3f9a1c42");
    expect(screen.getByTestId("inbox-project-group-toggle-proj-a")).toHaveAttribute("aria-expanded", "true");
  });

  it("a folded group keeps its header but renders no cards", () => {
    renderWith({ isCollapsed: true });
    expect(screen.getByTestId("inbox-project-group-proj-a")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-card-tu-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("inbox-project-group-toggle-proj-a")).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the header pill folds via onToggle", () => {
    const onToggle = vi.fn();
    renderWith({ onToggle });
    fireEvent.click(screen.getByTestId("inbox-project-group-toggle-proj-a"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the move handle only when the group can be reordered", () => {
    const { unmount } = renderWith({});
    expect(screen.queryByTestId("inbox-group-handle-proj-a")).not.toBeInTheDocument();
    unmount();
    renderWith({ reorder: { onMove: vi.fn(), canUp: false, canDown: true } });
    expect(screen.getByTestId("inbox-group-handle-proj-a")).toBeInTheDocument();
  });

  it("arrow keys on the handle move the group; a blocked direction does nothing", () => {
    const onMove = vi.fn();
    renderWith({ reorder: { onMove, canUp: false, canDown: true } });
    const handle = screen.getByTestId("inbox-group-handle-proj-a");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onMove).toHaveBeenCalledWith(1);
  });
});
