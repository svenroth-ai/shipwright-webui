/*
 * Shared test fixtures for the C7 inbox split test suite.
 *
 * Extracted from useInboxData.test.ts during C7 to keep each test file
 * under the 300-LOC cleanup-invariant for new files. Pure factories — no
 * mocks, no side-effects.
 */
import type {
  AskToolInboxItem,
  ExternalTask,
  InboxItem,
} from "../../../lib/externalApi";
import type { Project } from "../../../types";

export function makeAskItem(
  overrides: Partial<AskToolInboxItem> = {},
): AskToolInboxItem {
  return {
    kind: "ask_tool",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    toolUseId: "tu-1",
    toolName: "AskUserQuestion",
    input: { parts: [{ question: "proceed?" }] },
    bestEffort: true,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "sess-1",
    cwd: "/tmp",
    pluginDirs: [],
    title: "task-1",
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

export function makeProject(overrides: Partial<Project> = {}): Project {
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

export type WireOpts = {
  items: InboxItem[];
  tasks: ExternalTask[];
  projects: Project[];
  isLoading?: boolean;
};
