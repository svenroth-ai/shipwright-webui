/*
 * InboxCard — `phase_gate` kind (iterate-2026-10-29-inbox-guided-phase-questions):
 * a guided phase paused at a human gate renders as an "Awaiting your reply"
 * card with the terminal-honesty line, keyed `pg-<taskId>`.
 */
import { describe, it, expect, vi } from "vitest";
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

import { InboxCard, inboxItemKey } from "./InboxCard";
import type { InboxItem } from "../../lib/externalApi";
import { makeTask } from "./__fixtures__/inbox-fixtures";

const item: InboxItem = {
  kind: "phase_gate",
  taskId: "t-pg",
  sessionUuid: "u-pg",
  taskTitle: "Plan phase",
  promptText: "A phase of this run is paused and waits for your answer.",
  bestEffort: true,
};

describe("InboxCard phase_gate", () => {
  // @covers FR-01.04
  it("keys the item pg-<taskId>", () => {
    expect(inboxItemKey(item)).toBe("pg-t-pg");
  });

  // @covers FR-01.04
  it("renders the waiting card with the terminal-honesty line", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <InboxCard item={item} task={makeTask({ taskId: "t-pg" })} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("inbox-card-pg-t-pg")).toBeTruthy();
    expect(screen.getByText("Awaiting your reply")).toBeTruthy();
    expect(screen.getByTestId("inbox-question-text-pg-t-pg").textContent).toContain(
      "waits for your answer",
    );
    expect(screen.getByTestId("inbox-honesty-pg-t-pg")).toBeTruthy();
  });
});
