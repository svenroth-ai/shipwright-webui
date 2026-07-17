/*
 * InboxPage — project-grouping + read-only Ask-bubble test.
 *
 * Iterate 3.7d-b3 rebuild:
 *   - Project grouping + (N open) counts from 3.7c-4 are preserved.
 *   - Cards are read-only: no `<textarea>`, no clickable option pills, no
 *     Launch button.
 *   - Single brown `Resume` button per card.
 *   - Whole-card click-through → `/tasks/<taskId>` via useNavigate.
 *
 * Hooks consumed by InboxPage (and therefore mocked here):
 *   useExternalInbox, useExternalTasks, useProjects, useLaunchTask.
 *
 * Load-bearing testids (also used by iterate-2/3 Playwright specs):
 *   - inbox-page
 *   - inbox-empty
 *   - inbox-session-<uuid>
 *   - inbox-item-<toolUseId> (legacy, retained on a hidden inner node)
 *   - inbox-card-<toolUseId> (new 3.7d-b3)
 *   - inbox-resume-<toolUseId> (new 3.7d-b3)
 *   - inbox-copy-resume-<toolUseId> (legacy, retained)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";

import InboxPage from "./InboxPage";
import type {
  AskToolInboxItem,
  ExternalTask,
  InboxItem,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
} from "../lib/externalApi";
import type { Project } from "../types";

// Hoisted mocks must be declared before the imports that consume them.
// Vitest lifts vi.mock to the top of the file so these factories run
// before the real hook modules resolve.
vi.mock("../hooks/useExternalInbox", () => ({
  useExternalInbox: vi.fn(),
}));

vi.mock("../hooks/useExternalTasks", () => ({
  useExternalTasks: vi.fn(),
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: vi.fn(),
}));

vi.mock("../hooks/useLaunchTask", () => ({
  useLaunchTask: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

import { useExternalInbox } from "../hooks/useExternalInbox";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";

const mockedInbox = vi.mocked(useExternalInbox);
const mockedTasks = vi.mocked(useExternalTasks);
const mockedProjects = vi.mocked(useProjects);

function makeTask(overrides: Partial<ExternalTask>): ExternalTask {
  return {
    taskId: "task-1",
    sessionUuid: "sess-1",
    cwd: "/tmp/cwd",
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

function makeAskItem(
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

function makeTextItem(
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

function makeTerminalPromptItem(
  overrides: Partial<TerminalPromptInboxItem> = {},
): TerminalPromptInboxItem {
  return {
    kind: "terminal_prompt",
    taskId: "task-1",
    sessionUuid: "sess-1",
    taskTitle: "task-1",
    promptText: "Which option?\n  1. Alpha\n  2. Beta\nEnter to select",
    bestEffort: true,
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

function wireHooks(opts: {
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

/** Task-detail route stub — surfaces the React-Router nav state so a test
 *  can assert the Inbox cards pass `{ focusTerminal: true }` (Phase 1 of
 *  iterate-2026-05-18-inbox-terminal-prompts). Keeps the load-bearing
 *  `task-detail-stub` testid so the pre-existing navigation tests pass. */
function TaskDetailStub() {
  const loc = useLocation();
  const params = useParams();
  const st = loc.state as { focusTerminal?: boolean } | null;
  return (
    <div
      data-testid="task-detail-stub"
      data-task-id={params.id ?? ""}
      data-focus-terminal={String(st?.focusTerminal === true)}
      data-search={loc.search}
    />
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/tasks/:id" element={<TaskDetailStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Two tasks across two projects, each with one pending item in its own
// session. Keeps the fixtures small while still proving cross-project
// grouping.
const TASK_A = makeTask({
  taskId: "task-A",
  sessionUuid: "sess-A",
  title: "Task in project A",
  projectId: "proj-a",
});
const TASK_B = makeTask({
  taskId: "task-B",
  sessionUuid: "sess-B",
  title: "Task in project B",
  projectId: "proj-b",
});

const ITEM_A = makeAskItem({
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "Task in project A",
  toolUseId: "tu-A",
});
const ITEM_B = makeAskItem({
  taskId: "task-B",
  sessionUuid: "sess-B",
  taskTitle: "Task in project B",
  toolUseId: "tu-B",
});

const PROJECT_A = makeProject({ id: "proj-a", name: "Project A" });
const PROJECT_B = makeProject({ id: "proj-b", name: "Project B" });

describe("InboxPage project grouping (iterate 3 remediation v2 / S4)", () => {
  beforeEach(() => {
    mockedInbox.mockReset();
    mockedTasks.mockReset();
    mockedProjects.mockReset();
  });

  it("renders sessions under their project group + preserves existing session testids", () => {
    wireHooks({
      items: [ITEM_A, ITEM_B],
      tasks: [TASK_A, TASK_B],
      projects: [PROJECT_A, PROJECT_B],
    });
    renderPage();

    expect(screen.getByTestId("inbox-page")).toBeInTheDocument();

    // One collapsible group per project.
    expect(screen.getByTestId("inbox-project-group-proj-a")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-project-group-proj-b")).toBeInTheDocument();

    // Sessions render under their projects (load-bearing testid from
    // iterate-2 Playwright specs).
    expect(screen.getByTestId("inbox-session-sess-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-session-sess-B")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-item-tu-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-item-tu-B")).toBeInTheDocument();

    // Project names render in the summary rows.
    expect(screen.getByText("Project A")).toBeInTheDocument();
    expect(screen.getByText("Project B")).toBeInTheDocument();
  });

  it("tasks with no matching project land in an Unassigned bucket", () => {
    const ORPHAN_ITEM = makeAskItem({
      taskId: "task-orphan",
      sessionUuid: "sess-orphan",
      toolUseId: "tu-orphan",
    });
    // No matching task at all — derives to the Unassigned bucket.
    wireHooks({
      items: [ORPHAN_ITEM],
      tasks: [],
      projects: [],
    });
    renderPage();

    expect(
      screen.getByTestId("inbox-project-group-unassigned"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-session-sess-orphan")).toBeInTheDocument();
  });

  it("renders the empty-state when there are no items", () => {
    wireHooks({ items: [], tasks: [], projects: [] });
    renderPage();

    expect(screen.getByTestId("inbox-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-session-sess-A")).not.toBeInTheDocument();
  });

  it("does NOT render the ProjectFilterDropdown anywhere on the page", () => {
    // v2 decision #1: dropdown removed from Inbox; grouping replaces it.
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    // The old v1 testid — must NOT be present.
    expect(
      screen.queryByTestId("inbox-project-filter-dropdown"),
    ).not.toBeInTheDocument();
    // And the shared primitive has no mount of its own on this page.
    expect(
      screen.queryByText(/All projects/i),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Answer / Dismiss / best-effort UI", () => {
    // v2 decision #2: answer POST + dismiss removed; best-effort pill gone.
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    expect(screen.queryByTestId("answer-tu-A")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dismiss-tu-A")).not.toBeInTheDocument();
    expect(screen.queryByText(/best-effort/i)).not.toBeInTheDocument();
  });

  it("renders a single Answer-in-terminal CTA per card (no Launch, no textarea)", () => {
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    // The single navigation CTA (A19: clipboard copy → terminal fallback). The
    // misleading legacy `inbox-copy-resume` testid is GONE — it no longer copies.
    expect(screen.getByTestId("inbox-resume-tu-A")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-copy-resume-tu-A")).not.toBeInTheDocument();

    // Launch-in-Terminal button from v2 is GONE.
    expect(screen.queryByTestId("inbox-launch-tu-A")).not.toBeInTheDocument();

    // Freetext input + send button from v2 are GONE (no answer POST,
    // webui never answers Claude — external-launch invariant).
    expect(screen.queryByTestId("inbox-freetext-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-freetext-send")).not.toBeInTheDocument();
  });

  it("renders option chips as display-only (no button / onclick)", () => {
    const ITEM_WITH_OPTIONS = makeAskItem({
      toolUseId: "tu-opts",
      taskId: "task-A",
      sessionUuid: "sess-A",
      taskTitle: "Task in project A",
      input: {
        questions: [
          {
            question: "JWT or Session?",
            options: [{ label: "JWT" }, { label: "Session" }],
          },
        ],
      },
    });
    wireHooks({
      items: [ITEM_WITH_OPTIONS],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    const { container } = renderPage();

    // Chips must be rendered but NOT as buttons — they're read-only.
    const chip0 = screen.getByTestId("inbox-option-chip-0");
    const chip1 = screen.getByTestId("inbox-option-chip-1");
    expect(chip0).toBeInTheDocument();
    expect(chip1).toBeInTheDocument();
    expect(chip0.tagName.toLowerCase()).not.toBe("button");
    expect(chip1.tagName.toLowerCase()).not.toBe("button");
    expect(chip0).toHaveTextContent("JWT");
    expect(chip1).toHaveTextContent("Session");

    // No <button> elements should wrap the option labels.
    const buttons = Array.from(container.querySelectorAll("button"));
    for (const b of buttons) {
      const txt = b.textContent ?? "";
      expect(txt).not.toMatch(/^\s*JWT\s*$/);
      expect(txt).not.toMatch(/^\s*Session\s*$/);
    }
  });

  it("whole-card click navigates to /tasks/<taskId>", () => {
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
    const card = screen.getByTestId("inbox-card-tu-A");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("tabIndex", "0");
    fireEvent.click(card);
    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();
  });

  it("Enter key on the card navigates to /tasks/<taskId>", () => {
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    const card = screen.getByTestId("inbox-card-tu-A");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();
  });

  it("clicking the CTA navigates to the task's terminal deep link (A19)", () => {
    wireHooks({
      items: [ITEM_A],
      tasks: [TASK_A],
      projects: [PROJECT_A],
    });
    renderPage();

    fireEvent.click(screen.getByTestId("inbox-resume-tu-A"));
    const stub = screen.getByTestId("task-detail-stub");
    expect(stub).toHaveAttribute("data-task-id", "task-A");
    expect(stub.getAttribute("data-search")).toContain("pane=terminal");
    expect(stub.getAttribute("data-search")).toContain("focus=terminal");
  });
});

// ---------- iterate 2026-05-15 inbox-awaiting-user ----------
describe("InboxPage — text_question cards", () => {
  beforeEach(() => {
    mockedInbox.mockReset();
    mockedTasks.mockReset();
    mockedProjects.mockReset();
  });

  it("renders a text_question card showing the detected question text", () => {
    const item = makeTextItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      questionId: "q-A",
      questionText: "Option 1 or Option 2 — which should I build?",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();

    expect(screen.getByTestId("inbox-card-q-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-question-text-q-A")).toHaveTextContent(
      "Option 1 or Option 2 — which should I build?",
    );
    // The "awaiting" affordance label.
    expect(screen.getByText(/awaiting your reply/i)).toBeInTheDocument();
  });

  it("text_question cards show the terminal CTA + NO option chips / freetext", () => {
    const item = makeTextItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      questionId: "q-A",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    const { container } = renderPage();

    // A19: the honest terminal CTA is present (navigation, not a write).
    expect(screen.getByTestId("inbox-resume-q-A")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-copy-resume-q-A")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-option-chip-0")).not.toBeInTheDocument();
    // No freetext input anywhere inside the card (the fence).
    expect(
      container.querySelector('[data-testid="inbox-card-q-A"] textarea'),
    ).toBeNull();
  });

  it("text_question card click-through navigates to /tasks/<taskId>", () => {
    const item = makeTextItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      questionId: "q-A",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();

    const card = screen.getByTestId("inbox-card-q-A");
    expect(card).toHaveAttribute("role", "button");
    fireEvent.click(card);
    expect(screen.getByTestId("task-detail-stub")).toBeInTheDocument();
  });

  // iterate-2026-05-19-inbox-markdown-render: text_question bodies are
  // Claude prose, so they render through the XSS-safe <MarkdownText>.
  it("renders text_question body as markdown (bold, inline code, bullet list)", () => {
    const item = makeTextItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      questionId: "q-A",
      questionText: "**Status** check `STATUS.md`\n\n- first\n- second",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();

    const body = screen.getByTestId("inbox-question-text-q-A");
    // **Status** → <strong>, `STATUS.md` → <code>, "- " list → two <li>.
    expect(body.querySelector("strong")).not.toBeNull();
    expect(body.querySelector("code")).not.toBeNull();
    expect(body.querySelectorAll("li").length).toBe(2);
    // The raw markdown markers are consumed — text is formatted, not literal.
    expect(body.textContent ?? "").not.toContain("**Status**");
  });

  it("text_question markdown does not execute raw HTML — XSS-safe", () => {
    const item = makeTextItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      questionId: "q-A",
      questionText: "<script>alert(1)</script> Shall I proceed?",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    const { container } = renderPage();

    // react-markdown has no rehype-raw → raw HTML never becomes a live node.
    expect(container.querySelector("script")).toBeNull();
    // …but the question text is still surfaced to the user.
    expect(screen.getByTestId("inbox-question-text-q-A")).toHaveTextContent(
      "Shall I proceed?",
    );
  });

  it("clicking an inbox card navigates to /tasks/:id with { focusTerminal: true } (Phase 1)", () => {
    wireHooks({ items: [ITEM_A], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();
    fireEvent.click(screen.getByTestId("inbox-card-tu-A"));
    const stub = screen.getByTestId("task-detail-stub");
    // Lands on the clicked task's detail route…
    expect(stub).toHaveAttribute("data-task-id", "task-A");
    // …carrying the focus-terminal intent.
    expect(stub).toHaveAttribute("data-focus-terminal", "true");
  });

  it("ask_tool and text_question cards render side by side across sessions", () => {
    // Precedence (`deriveSessionInbox`) means a single session never yields
    // BOTH kinds — a pending tool_use suppresses the text question (spec
    // AC-5). But the aggregate inbox across tasks does mix them. This proves
    // the `InboxCard` dispatcher + `inboxItemKey` handle a mixed item list.
    const ask = makeAskItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      taskTitle: "Task in project A",
      toolUseId: "tu-A",
    });
    const text = makeTextItem({
      taskId: "task-B",
      sessionUuid: "sess-B",
      taskTitle: "Task in project B",
      questionId: "q-B",
    });
    wireHooks({
      items: [ask, text],
      tasks: [TASK_A, TASK_B],
      projects: [PROJECT_A, PROJECT_B],
    });
    renderPage();

    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-card-q-B")).toBeInTheDocument();
  });
});

// ---------- iterate-2026-05-18-inbox-terminal-prompts ----------
describe("InboxPage — terminal_prompt cards", () => {
  beforeEach(() => {
    mockedInbox.mockReset();
    mockedTasks.mockReset();
    mockedProjects.mockReset();
  });

  it("renders a terminal_prompt card showing the captured picker text", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      taskTitle: "Task in project A",
      promptText: "Von wo aus?\n  1. Board\n  2. Detail\nEnter to select",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();

    expect(screen.getByTestId("inbox-card-tp-task-A")).toBeInTheDocument();
    expect(
      screen.getByTestId("inbox-question-text-tp-task-A"),
    ).toHaveTextContent("Von wo aus?");
    expect(screen.getByText(/awaiting your reply/i)).toBeInTheDocument();
  });

  it("terminal_prompt card shows the terminal CTA, no freetext input", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();
    // The freetext-fence (no textarea anywhere) is proven globally by
    // inbox-no-writepath.test.ts; here we assert the CTA is present.
    expect(screen.getByTestId("inbox-resume-tp-task-A")).toBeInTheDocument();
  });

  it("renders promptText as escaped plain-text — no HTML injection", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      promptText: "<img src=x onerror=alert(1)> pick one",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    const { container } = renderPage();
    expect(
      screen.getByTestId("inbox-question-text-tp-task-A"),
    ).toHaveTextContent("<img src=x onerror=alert(1)> pick one");
    expect(container.querySelector("img")).toBeNull();
  });

  // iterate-2026-05-19-inbox-markdown-render: a terminal_prompt body is a
  // live xterm picker (numbered menu + box characters), NOT prose — it must
  // stay escaped plain-text so markdown never reflows the menu layout.
  it("terminal_prompt body is NOT markdown-rendered — markdown syntax stays literal", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
      promptText: "**Pick one**\n  1. Alpha\n  2. Beta",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();

    const body = screen.getByTestId("inbox-question-text-tp-task-A");
    expect(body.querySelector("strong")).toBeNull();
    expect(body.querySelector("li")).toBeNull();
    expect(body.textContent ?? "").toContain("**Pick one**");
  });

  it("terminal_prompt card click carries the focusTerminal nav-state", () => {
    const item = makeTerminalPromptItem({
      taskId: "task-A",
      sessionUuid: "sess-A",
    });
    wireHooks({ items: [item], tasks: [TASK_A], projects: [PROJECT_A] });
    renderPage();
    fireEvent.click(screen.getByTestId("inbox-card-tp-task-A"));
    const stub = screen.getByTestId("task-detail-stub");
    expect(stub).toHaveAttribute("data-task-id", "task-A");
    expect(stub).toHaveAttribute("data-focus-terminal", "true");
  });
});
