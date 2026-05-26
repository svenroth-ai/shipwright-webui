/*
 * useInboxData — wrapper-contract tests (C7 — 2026-05-26).
 *
 * Covers the wrapper contract (it doesn't own the queries, it just composes
 * + derives):
 *   - Each underlying TanStack hook called exactly once per render with
 *     ZERO args (openai HIGH — "memo stability ≠ query-key stability").
 *   - useMemo deps depend on .data, not the wrapper objects (gemini HIGH).
 *   - isLoading mirrors useExternalInbox().isLoading EXACTLY (openai MED).
 *   - Recompute on data-change (code-review MED).
 *
 * Derivation semantics (grouping, ordering, Unassigned bucket) live in
 * useInboxData.derivation.test.ts to keep each file under 300 LOC.
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
import type {
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
  isLoading?: boolean;
}) {
  mockedInbox.mockReturnValue({
    data: opts.items,
    isLoading: opts.isLoading ?? false,
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

describe("useInboxData — wrapper contract", () => {
  beforeEach(() => {
    mockedInbox.mockReset();
    mockedTasks.mockReset();
    mockedProjects.mockReset();
  });

  it("calls each underlying hook exactly once per render with ZERO args (openai HIGH)", () => {
    wire({ items: [], tasks: [], projects: [] });
    renderHook(() => useInboxData(), { wrapper });
    expect(mockedInbox).toHaveBeenCalledTimes(1);
    expect(mockedTasks).toHaveBeenCalledTimes(1);
    expect(mockedProjects).toHaveBeenCalledTimes(1);
    expect(mockedInbox).toHaveBeenCalledWith();
    expect(mockedTasks).toHaveBeenCalledWith();
    expect(mockedProjects).toHaveBeenCalledWith();
  });

  it("isLoading mirrors useExternalInbox().isLoading (openai MED)", () => {
    wire({ items: [], tasks: [], projects: [], isLoading: true });
    const { result } = renderHook(() => useInboxData(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it("memo identity stable across re-renders when underlying data unchanged (gemini HIGH)", () => {
    const items: InboxItem[] = [];
    const tasks: ExternalTask[] = [];
    const projects: Project[] = [];
    wire({ items, tasks, projects });
    const { result, rerender } = renderHook(() => useInboxData(), { wrapper });
    const first = result.current.projectGroups;
    rerender();
    expect(result.current.projectGroups).toBe(first);
  });

  it("recomputes when underlying inbox/tasks/projects change (code-review MED)", () => {
    const PROJECT_A = makeProject({ id: "proj-a", name: "Project A" });
    const TASK_A = makeTask({
      taskId: "task-A",
      sessionUuid: "sess-A",
      projectId: "proj-a",
    });
    wire({
      items: [
        makeAskItem({
          toolUseId: "tu-1",
          taskId: "task-A",
          sessionUuid: "sess-A",
        }),
      ],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    const { result, rerender } = renderHook(() => useInboxData(), { wrapper });
    expect(result.current.openCount).toBe(1);
    expect(result.current.projectGroups).toHaveLength(1);

    const PROJECT_B = makeProject({ id: "proj-b", name: "Project B" });
    const TASK_B = makeTask({
      taskId: "task-B",
      sessionUuid: "sess-B",
      projectId: "proj-b",
      title: "task-B-title",
    });
    wire({
      items: [
        makeAskItem({
          toolUseId: "tu-1",
          taskId: "task-A",
          sessionUuid: "sess-A",
        }),
        makeAskItem({
          toolUseId: "tu-2",
          taskId: "task-B",
          sessionUuid: "sess-B",
        }),
      ],
      tasks: [TASK_A, TASK_B],
      projects: [PROJECT_A, PROJECT_B],
    });
    rerender();
    expect(result.current.openCount).toBe(2);
    expect(result.current.projectGroups).toHaveLength(2);
    expect(result.current.tasksById.size).toBe(2);
    expect(result.current.tasksById.get("task-B")?.title).toBe("task-B-title");
  });
});
