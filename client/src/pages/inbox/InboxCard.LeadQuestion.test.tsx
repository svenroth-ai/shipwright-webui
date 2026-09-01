/*
 * InboxCard.LeadQuestion.test.tsx — FR-04.17/18/19: the answer form
 * PATCHes poFeedback with a timestamp, and Dismiss calls the lq-<taskId>
 * dismiss endpoint. Network is a stubbed global fetch (boardColumnApi.test.ts
 * convention).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { LeadQuestionCard } from "./InboxCard.LeadQuestion";
import type { ExternalTask } from "../../lib/externalApi";
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

const LEAD: LeadQuestionInboxItem = {
  kind: "lead_question",
  taskId: "task-A",
  sessionUuid: "sess-A",
  taskTitle: "task-A",
  questionText: "Are we good to ship?",
};

function renderCard(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={node} />
          <Route path="/tasks/:id" element={<div data-testid="task-detail-stub" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LeadQuestionCard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Send answer PATCHes poFeedback with the typed text plus a timestamp", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: makeTask() }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCard(<LeadQuestionCard item={LEAD} task={makeTask()} />);

    fireEvent.change(screen.getByTestId("inbox-lead-answer-input-lq-task-A"), {
      target: { value: "Yes, proceed." },
    });
    fireEvent.click(screen.getByTestId("inbox-lead-answer-send-lq-task-A"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/external/tasks/task-A");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body.poFeedback).toMatch(/^Yes, proceed\.\n\n<!-- answered-at:.+-->$/);
  });

  it("Send answer is disabled for empty/whitespace-only text", () => {
    renderCard(<LeadQuestionCard item={LEAD} task={makeTask()} />);
    expect(screen.getByTestId("inbox-lead-answer-send-lq-task-A")).toBeDisabled();

    fireEvent.change(screen.getByTestId("inbox-lead-answer-input-lq-task-A"), {
      target: { value: "   " },
    });
    expect(screen.getByTestId("inbox-lead-answer-send-lq-task-A")).toBeDisabled();
  });

  it("Dismiss calls the lq-<taskId> dismiss endpoint, not the card's navigate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, taskId: "task-A" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCard(<LeadQuestionCard item={LEAD} task={makeTask()} />);
    fireEvent.click(screen.getByTestId("inbox-lead-dismiss-lq-task-A"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/external/inbox/lq-task-A/dismiss",
      expect.objectContaining({ method: "POST" }),
    );
    // Dismiss must not also navigate to the task (stopPropagation).
    expect(screen.queryByTestId("task-detail-stub")).not.toBeInTheDocument();
  });

  // FR-04.37 outbound (the internal `<!-- lead-question:TYPE -->` marker must
  // never reach this card) is proved server-side, where the stripping
  // actually happens: server/src/external/inbox/_lead.test.ts's
  // `extractLeadQuestionBody` cases. A client-side assertion on already-
  // stripped input would prove nothing about the stripping itself.
});
