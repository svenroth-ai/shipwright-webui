/*
 * useInboxData — derivation-semantics tests (C7 — 2026-05-26).
 *
 * Companion to useInboxData.test.ts (the wrapper-contract file). Covers the
 * pure-derivation surface lifted line-for-line from InboxPage source:
 *   - openCount sums correctly.
 *   - Unassigned bucket logic — task missing OR projectId === unassigned.
 *   - Session + item ordering preserved (openai MED — line-for-line).
 *
 * Split off from useInboxData.test.ts to keep each test file under the
 * 300-LOC cleanup-invariant for new files.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

vi.mock("../../hooks/useExternalInbox", () => ({
  useExternalInbox: vi.fn(),
}));
vi.mock("../../hooks/useExternalTasks", () => ({
  useExternalTasks: vi.fn(),
}));
vi.mock("../../hooks/useProjects", () => ({
  useProjects: vi.fn(),
}));

import { useExternalInbox } from "../../hooks/useExternalInbox";
import { useExternalTasks } from "../../hooks/useExternalTasks";
import { useProjects } from "../../hooks/useProjects";
import { useInboxData } from "./useInboxData";
import { UNASSIGNED_PROJECT_ID } from "../../lib/projectIds";
import type {
  AskToolInboxItem,
  ExternalTask,
  InboxItem,
} from "../../lib/externalApi";
import type { Project } from "../../types";
import { makeAskItem, makeProject, makeTask } from "./__fixtures__/inbox-fixtures";

const mockedInbox = vi.mocked(useExternalInbox);
const mockedTasks = vi.mocked(useExternalTasks);
const mockedProjects = vi.mocked(useProjects);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function wire(opts: {
  items: InboxItem[];
  tasks: ExternalTask[];
  projects: Project[];
}) {
  mockedInbox.mockReturnValue({
    data: opts.items,
    isLoading: false,
  } as unknown as ReturnType<typeof useExternalInbox>);
  mockedTasks.mockReturnValue({
    data: opts.tasks,
    isLoading: false,
  } as unknown as ReturnType<typeof useExternalTasks>);
  mockedProjects.mockReturnValue({
    data: opts.projects,
    isLoading: false,
  } as unknown as ReturnType<typeof useProjects>);
}

describe("useInboxData — derivation semantics", () => {
  beforeEach(() => {
    mockedInbox.mockReset();
    mockedTasks.mockReset();
    mockedProjects.mockReset();
  });

  it("openCount sums items across project groups", () => {
    const PROJECT_A = makeProject({ id: "proj-a", name: "Project A" });
    const PROJECT_B = makeProject({ id: "proj-b", name: "Project B" });
    const TASK_A = makeTask({
      taskId: "task-A",
      sessionUuid: "sess-A",
      projectId: "proj-a",
    });
    const TASK_B = makeTask({
      taskId: "task-B",
      sessionUuid: "sess-B",
      projectId: "proj-b",
    });
    const items = [
      makeAskItem({
        toolUseId: "tu-1",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
      makeAskItem({
        toolUseId: "tu-2",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
      makeAskItem({
        toolUseId: "tu-3",
        taskId: "task-B",
        sessionUuid: "sess-B",
      }),
    ];
    wire({ items, tasks: [TASK_A, TASK_B], projects: [PROJECT_A, PROJECT_B] });
    const { result } = renderHook(() => useInboxData(), { wrapper });
    expect(result.current.openCount).toBe(3);
    expect(result.current.projectGroups).toHaveLength(2);
  });

  it("Unassigned bucket — task missing OR projectId === unassigned (openai MED)", () => {
    const PROJECT_A = makeProject({ id: "proj-a", name: "Project A" });
    const TASK_A = makeTask({
      taskId: "task-A",
      sessionUuid: "sess-A",
      projectId: "proj-a",
    });
    const TASK_UNASSIGNED = makeTask({
      taskId: "task-U",
      sessionUuid: "sess-U",
      projectId: UNASSIGNED_PROJECT_ID,
    });
    const items = [
      makeAskItem({
        toolUseId: "tu-A",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
      makeAskItem({
        toolUseId: "tu-U",
        taskId: "task-U",
        sessionUuid: "sess-U",
      }),
      makeAskItem({
        toolUseId: "tu-orphan",
        taskId: "task-missing",
        sessionUuid: "sess-orphan",
      }),
    ];
    wire({
      items,
      tasks: [TASK_A, TASK_UNASSIGNED],
      projects: [PROJECT_A],
    });
    const { result } = renderHook(() => useInboxData(), { wrapper });
    const byId = new Map(
      result.current.projectGroups.map((g) => [g.projectId, g]),
    );
    expect(byId.get("proj-a")?.totalItems).toBe(1);
    const unassigned = byId.get(UNASSIGNED_PROJECT_ID);
    expect(unassigned?.totalItems).toBe(2);
    expect(unassigned?.projectName).toBe("Unassigned");
  });

  it("session ordering and item ordering preserved verbatim (openai MED)", () => {
    const PROJECT_A = makeProject({ id: "proj-a", name: "Project A" });
    const TASK_A = makeTask({
      taskId: "task-A",
      sessionUuid: "sess-A",
      projectId: "proj-a",
    });
    const items = [
      makeAskItem({
        toolUseId: "tu-1",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
      makeAskItem({
        toolUseId: "tu-2",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
      makeAskItem({
        toolUseId: "tu-3",
        taskId: "task-A",
        sessionUuid: "sess-A",
      }),
    ];
    wire({ items, tasks: [TASK_A], projects: [PROJECT_A] });
    const { result } = renderHook(() => useInboxData(), { wrapper });
    const sg = result.current.projectGroups[0]?.sessions[0];
    expect(sg?.items.map((it) => (it as AskToolInboxItem).toolUseId)).toEqual([
      "tu-1",
      "tu-2",
      "tu-3",
    ]);
  });
});
