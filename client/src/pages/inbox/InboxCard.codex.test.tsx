/*
 * InboxCard — Codex Light AC6/§5.3 dispatcher coverage for the three new
 * kinds (`codex_watcher`, `codex_approval`, `codex_error`). New file rather
 * than an addition to InboxCard.test.tsx (that file sits at 228/300 lines —
 * same convention as the other self-contained sibling test files in this
 * repo, e.g. EditTaskModal.runtime-toggle.test.tsx).
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
import {
  makeCodexApprovalItem,
  makeCodexErrorItem,
  makeCodexWatcherItem,
  makeTask,
} from "./__fixtures__/inbox-fixtures";

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

describe("InboxCard — codex_approval (Codex Light §5.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to WaitingReplyCard — inbox-card-ca-<taskId> testid, plain text (no markdown)", () => {
    const item = makeCodexApprovalItem();
    renderCard(<InboxCard item={item} task={makeTask({ taskId: "task-1" })} />);
    expect(screen.getByTestId("inbox-card-ca-task-1")).toBeInTheDocument();
    const body = screen.getByTestId("inbox-question-text-ca-task-1");
    expect(body.textContent ?? "").toContain("Allow Codex to run");
    expect(screen.getByText(/awaiting your reply/i)).toBeInTheDocument();
  });

  it("clicking the card navigates to the task with focusTerminal", () => {
    const item = makeCodexApprovalItem();
    renderCard(<InboxCard item={item} task={makeTask({ taskId: "task-1" })} />);
    fireEvent.click(screen.getByTestId("inbox-card-ca-task-1"));
    const stub = screen.getByTestId("task-detail-stub");
    expect(stub).toHaveAttribute("data-task-id", "task-1");
    expect(stub).toHaveAttribute("data-focus-terminal", "true");
  });

  it("inboxItemKey returns ca-<taskId>", () => {
    expect(inboxItemKey(makeCodexApprovalItem())).toBe("ca-task-1");
  });
});

describe("InboxCard — codex_error (Codex Light §5.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to CodexNoticeCard — inbox-card-ce-<taskId> testid, error label", () => {
    const item = makeCodexErrorItem();
    renderCard(<InboxCard item={item} task={makeTask({ taskId: "task-1" })} />);
    expect(screen.getByTestId("inbox-card-ce-task-1")).toBeInTheDocument();
    expect(screen.getByText(/codex error/i)).toBeInTheDocument();
    expect(screen.getByTestId("inbox-question-text-ce-task-1")).toHaveTextContent(
      "Something went wrong",
    );
  });

  it("inboxItemKey returns ce-<taskId>", () => {
    expect(inboxItemKey(makeCodexErrorItem())).toBe("ce-task-1");
  });
});

describe("InboxCard — codex_watcher (Codex Light AC6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes to CodexNoticeCard — inbox-card-cw-<taskId> testid, notice-kind label", () => {
    const item = makeCodexWatcherItem({ noticeKind: "delivery_error" });
    renderCard(<InboxCard item={item} task={makeTask({ taskId: "task-1" })} />);
    expect(screen.getByTestId("inbox-card-cw-task-1")).toBeInTheDocument();
    expect(screen.getByText(/delivery failed/i)).toBeInTheDocument();
    expect(screen.getByTestId("inbox-question-text-cw-task-1")).toHaveTextContent(
      "Sent a nudge",
    );
  });

  it("inboxItemKey returns cw-<taskId>", () => {
    expect(inboxItemKey(makeCodexWatcherItem())).toBe("cw-task-1");
  });

  it("without a task — no nav/keyboard role", () => {
    const item = makeCodexWatcherItem();
    renderCard(<InboxCard item={item} task={undefined} />);
    const card = screen.getByTestId("inbox-card-cw-task-1");
    expect(card).not.toHaveAttribute("role", "button");
  });
});
