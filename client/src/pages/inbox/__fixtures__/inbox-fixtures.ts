/*
 * Shared test fixtures for the C7 inbox split test suite.
 *
 * Extracted from useInboxData.test.ts during C7 to keep each test file
 * under the 300-LOC cleanup-invariant for new files. Pure factories — no
 * mocks, no side-effects.
 */
import type {
  AskToolInboxItem,
  CodexApprovalInboxItem,
  CodexErrorInboxItem,
  CodexWatcherInboxItem,
  ExternalTask,
  InboxItem,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
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

export function makeTextItem(
  overrides: Partial<TextQuestionInboxItem> = {},
): TextQuestionInboxItem {
  return {
    kind: "text_question",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    questionId: "q-1",
    questionText: "How should I proceed?",
    bestEffort: true,
    ...overrides,
  };
}

export function makeTerminalPromptItem(
  overrides: Partial<TerminalPromptInboxItem> = {},
): TerminalPromptInboxItem {
  return {
    kind: "terminal_prompt",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    promptText: "❯ Overwrite existing migration? (y/N)",
    bestEffort: true,
    ...overrides,
  };
}

export function makeCodexWatcherItem(
  overrides: Partial<CodexWatcherInboxItem> = {},
): CodexWatcherInboxItem {
  return {
    kind: "codex_watcher",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    noticeKind: "nudge_sent",
    detail: "Sent a nudge — the completion oracle reports this run isn't done yet.",
    bestEffort: true,
    ...overrides,
  };
}

export function makeCodexApprovalItem(
  overrides: Partial<CodexApprovalInboxItem> = {},
): CodexApprovalInboxItem {
  return {
    kind: "codex_approval",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    promptText: "Allow Codex to run `rm -rf node_modules`?\n1. Yes\n2. No",
    bestEffort: true,
    ...overrides,
  };
}

export function makeCodexErrorItem(
  overrides: Partial<CodexErrorInboxItem> = {},
): CodexErrorInboxItem {
  return {
    kind: "codex_error",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    errorText: "turn aborted. Something went wrong? Hit `/feedback` to report the issue.",
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
