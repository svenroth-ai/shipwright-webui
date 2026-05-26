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
import { render, screen } from "@testing-library/react";
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

  it("renders project label + (N open) count + chevron-color chip", () => {
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
    expect(screen.getByText("(2 open)")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-group-color-proj-a")).toBeInTheDocument();
  });

  it("Unassigned bucket uses the muted-token chip", () => {
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
    // Muted-token uses var(--color-muted) — same as source line 302-304.
    expect(chip.getAttribute("style") ?? "").toContain("var(--color-muted)");
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
