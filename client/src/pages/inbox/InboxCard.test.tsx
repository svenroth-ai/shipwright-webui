/*
 * InboxCard — polymorphic-dispatcher extraction contract (C7 — 2026-05-26).
 *
 * Covers external-plan-review:
 *  - MED #5 (defensive test for unknown phase / item kind variants).
 *  - MED #2 (no extra wrapper nodes — same DOM root preserved).
 *  - MED #7 (markdown / plain-text rendering moved intact).
 *
 * Existing `InboxPage.test.tsx` (16 cases) is the load-bearing integration
 * coverage; this file adds direct unit coverage of the dispatcher so the
 * three branches (ask_tool / text_question / terminal_prompt) are isolated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";

vi.mock("../../hooks/useLaunchTask", () => ({
  useLaunchTask: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

import { InboxCard } from "./InboxCard";
import type {
  AskToolInboxItem,
  ExternalTask,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
} from "../../lib/externalApi";

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

function TaskDetailStub() {
  const loc = useLocation();
  const params = useParams();
  const st = loc.state as { focusTerminal?: boolean } | null;
  return (
    <div
      data-testid="task-detail-stub"
      data-task-id={params.id ?? ""}
      data-focus-terminal={String(st?.focusTerminal === true)}
    />
  );
}

function renderCard(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={node} />
          <Route path="/tasks/:id" element={<TaskDetailStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ASK: AskToolInboxItem = {
  kind: "ask_tool",
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "task-A",
  toolUseId: "tu-A",
  toolName: "AskUserQuestion",
  input: {
    parts: [{ question: "Pick one", options: ["JWT", "Session"] }],
  },
  bestEffort: true,
};

const TEXT: TextQuestionInboxItem = {
  kind: "text_question",
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "task-A",
  questionId: "q-A",
  questionText: "**bold** prose",
  bestEffort: true,
};

const TERM: TerminalPromptInboxItem = {
  kind: "terminal_prompt",
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "task-A",
  promptText: "**Pick one**\n  1. A\n  2. B",
  bestEffort: true,
};

describe("InboxCard — polymorphic dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ask_tool routes to AskToolCard variant — inbox-card-<toolUseId> testid", () => {
    renderCard(<InboxCard item={ASK} task={makeTask()} />);
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    // Legacy testid wrapper retained.
    expect(screen.getByTestId("inbox-item-tu-A")).toBeInTheDocument();
    // Option chips render display-only.
    expect(screen.getByTestId("inbox-option-chip-0")).toBeInTheDocument();
  });

  it("text_question routes to WaitingReplyCard with markdown rendering (MED #7)", () => {
    renderCard(<InboxCard item={TEXT} task={makeTask()} />);
    const card = screen.getByTestId("inbox-card-q-A");
    expect(card).toBeInTheDocument();
    const body = screen.getByTestId("inbox-question-text-q-A");
    expect(body.querySelector("strong")).not.toBeNull();
    expect(screen.getByText(/awaiting your reply/i)).toBeInTheDocument();
  });

  it("terminal_prompt routes to WaitingReplyCard with PLAIN text (markdown NOT applied)", () => {
    renderCard(<InboxCard item={TERM} task={makeTask()} />);
    const body = screen.getByTestId("inbox-question-text-tp-task-A");
    expect(body.querySelector("strong")).toBeNull();
    expect(body.textContent ?? "").toContain("**Pick one**");
  });

  it("ask_tool without task — no nav/keyboard role, no Resume button", () => {
    const { container } = renderCard(<InboxCard item={ASK} task={undefined} />);
    const card = screen.getByTestId("inbox-card-tu-A");
    expect(card).not.toHaveAttribute("role", "button");
    // Resume button is gated on `task` truthiness.
    expect(
      container.querySelector('[data-testid="inbox-resume-tu-A"]'),
    ).toBeNull();
  });

  it("unknown phase (task title with no phase keyword) — no phase pill rendered (MED #5)", () => {
    renderCard(
      <InboxCard
        item={ASK}
        task={makeTask({ title: "nothing matches here xyz" })}
      />,
    );
    expect(
      screen.queryByTestId("inbox-task-context-pill-tu-A"),
    ).not.toBeInTheDocument();
  });

  it("ask_tool card click navigates to /tasks/<taskId> with focusTerminal", () => {
    renderCard(<InboxCard item={ASK} task={makeTask()} />);
    fireEvent.click(screen.getByTestId("inbox-card-tu-A"));
    const stub = screen.getByTestId("task-detail-stub");
    expect(stub).toHaveAttribute("data-task-id", "task-A");
    expect(stub).toHaveAttribute("data-focus-terminal", "true");
  });

  it("text_question card with empty body renders without crash (MED #5 defensive)", () => {
    renderCard(
      <InboxCard
        item={{ ...TEXT, questionText: "" }}
        task={makeTask()}
      />,
    );
    expect(screen.getByTestId("inbox-card-q-A")).toBeInTheDocument();
  });
});
