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

import { InboxCard, inboxItemKey } from "./InboxCard";
import type {
  AskToolInboxItem,
  ExternalTask,
  InboxItem,
  TerminalPromptInboxItem,
  TextQuestionInboxItem,
} from "../../lib/externalApi";
import type { LeadQuestionInboxItem } from "../../lib/leadQuestionApi";

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

const LEAD: LeadQuestionInboxItem = {
  kind: "lead_question",
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "task-A",
  questionText: "Are we good to ship?",
};

describe("InboxCard — polymorphic dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @covers FR-01.04
  it("ask_tool renders a row — inbox-card-<toolUseId> testid; the dialog has the display-only options", () => {
    renderCard(<InboxCard item={ASK} task={makeTask()} />);
    expect(screen.getByTestId("inbox-card-tu-A")).toBeInTheDocument();
    // Legacy testid wrapper retained.
    expect(screen.getByTestId("inbox-item-tu-A")).toBeInTheDocument();
    // Option chips render display-only, in the dialog.
    fireEvent.click(screen.getByTestId("inbox-row-title-tu-A"));
    expect(screen.getByTestId("inbox-option-chip-0")).toBeInTheDocument();
  });

  // @covers FR-01.04
  it("text_question renders the row with markdown marks stripped; the dialog renders markdown (MED #7)", () => {
    renderCard(<InboxCard item={TEXT} task={makeTask()} />);
    const card = screen.getByTestId("inbox-card-q-A");
    expect(card).toBeInTheDocument();
    // Row: plain first line, no markup characters.
    expect(screen.getByTestId("inbox-row-title-q-A")).toHaveTextContent("bold prose");
    expect(screen.getByTestId("inbox-chip-q-A")).toHaveTextContent(/awaiting reply/i);
    fireEvent.click(screen.getByTestId("inbox-row-title-q-A"));
    const body = screen.getByTestId("inbox-question-text-q-A");
    expect(body.querySelector("strong")).not.toBeNull();
  });

  // @covers FR-01.04
  it("terminal_prompt dialog shows PLAIN text (markdown NOT applied)", () => {
    renderCard(<InboxCard item={TERM} task={makeTask()} />);
    fireEvent.click(screen.getByTestId("inbox-row-title-tp-task-A"));
    const body = screen.getByTestId("inbox-question-text-tp-task-A");
    expect(body.querySelector("strong")).toBeNull();
    expect(body.textContent ?? "").toContain("**Pick one**");
  });

  // @covers FR-01.04
  it("ask_tool without task — no nav/keyboard role, no Resume button", () => {
    const { container } = renderCard(<InboxCard item={ASK} task={undefined} />);
    const card = screen.getByTestId("inbox-card-tu-A");
    expect(card).not.toHaveAttribute("role", "button");
    // Resume button is gated on `task` truthiness.
    expect(
      container.querySelector('[data-testid="inbox-resume-tu-A"]'),
    ).toBeNull();
  });

  // @covers FR-01.04
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

  // @covers FR-01.04
  it("row click opens the dialog (no navigation); Open task goes to /tasks/<taskId> with focusTerminal", () => {
    renderCard(<InboxCard item={ASK} task={makeTask()} />);
    fireEvent.click(screen.getByTestId("inbox-card-tu-A"));
    expect(screen.getByTestId("inbox-detail-tu-A")).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inbox-open-task-tu-A"));
    const stub = screen.getByTestId("task-detail-stub");
    expect(stub).toHaveAttribute("data-task-id", "task-A");
    expect(stub).toHaveAttribute("data-focus-terminal", "true");
  });

  // @covers FR-01.04
  it("the row is keyboard reachable: its title is a real button; Open task from a text_question goes to the task", () => {
    renderCard(<InboxCard item={TEXT} task={makeTask()} />);
    const title = screen.getByTestId("inbox-row-title-q-A");
    expect(title.tagName.toLowerCase()).toBe("button");
    fireEvent.click(title);
    fireEvent.click(screen.getByTestId("inbox-open-task-q-A"));
    expect(screen.getByTestId("task-detail-stub")).toHaveAttribute("data-task-id", "task-A");
  });

  // @covers FR-01.04
  it("text_question card with empty body renders without crash (MED #5 defensive)", () => {
    renderCard(
      <InboxCard
        item={{ ...TEXT, questionText: "" }}
        task={makeTask()}
      />,
    );
    expect(screen.getByTestId("inbox-card-q-A")).toBeInTheDocument();
  });

  // @covers FR-01.72
  it("lead_question renders a row — inbox-card-lq-<taskId> testid; the dialog carries the answer form", () => {
    renderCard(<InboxCard item={LEAD} task={makeTask()} />);
    expect(screen.getByTestId("inbox-card-lq-task-A")).toBeInTheDocument();
    // No answer form on the row itself.
    expect(screen.queryByTestId("inbox-lead-answer-input-lq-task-A")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inbox-row-title-lq-task-A"));
    expect(screen.getByTestId("inbox-question-text-lq-task-A")).toHaveTextContent(
      "Are we good to ship?",
    );
    expect(screen.getByTestId("inbox-lead-answer-input-lq-task-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-lead-answer-send-lq-task-A")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-lead-dismiss-lq-task-A")).toBeInTheDocument();
  });
});

describe("InboxCard / inboxItemKey — exhaustiveness guard (FR-04.19 trap 3/4)", () => {
  it("inboxItemKey returns lq-<taskId> for a lead_question item", () => {
    expect(inboxItemKey(LEAD)).toBe("lq-task-A");
  });

  it("inboxItemKey throws (never a silent undefined key) for an unrecognized kind", () => {
    const bogus = { kind: "bogus_kind", taskId: "x" } as unknown as InboxItem;
    expect(() => inboxItemKey(bogus)).toThrow(/unhandled inbox item kind/);
  });

  it("InboxCard throws (never a silent wrong-card render) for an unrecognized kind", () => {
    const bogus = { kind: "bogus_kind", taskId: "x" } as unknown as InboxItem;
    expect(() =>
      renderCard(<InboxCard item={bogus} task={makeTask()} />),
    ).toThrow(/unhandled inbox item kind/);
  });
});
