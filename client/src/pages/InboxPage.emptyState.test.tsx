/*
 * Inbox teaching empty state (A07 / FR-01.50).
 *
 * Standalone from InboxPage.test.tsx (which is at its bloat ceiling). Only the
 * empty case is exercised here, so a minimal all-empty hook mock suffices — no
 * task/item fixtures. Asserts the AC1 shape: verbatim heading + sentence, the
 * "approval gate" glossary tooltip, and EXACTLY one call to action.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import InboxPage from "./InboxPage";
import { glossaryLookup } from "../lib/glossary";

vi.mock("../hooks/useExternalInbox", () => ({
  useExternalInbox: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("../hooks/useExternalTasks", () => ({
  useExternalTasks: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("../hooks/useProjects", () => ({
  useProjects: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("../hooks/useLaunchTask", () => ({
  useLaunchTask: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/inbox"]}>
        <InboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InboxPage teaching empty state (A07 / FR-01.50)", () => {
  it("shows the verbatim heading + teaching sentence", () => {
    renderPage();
    expect(screen.getByText("Your inbox is clear")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-empty-sentence")).toHaveTextContent(
      "When Shipwright needs a decision from you mid-run — a question, or an approval gate — it lands here so you never have to watch the terminal. Nothing is waiting right now.",
    );
  });

  it("glosses 'approval gate' with its glossary explanation (tooltip)", () => {
    renderPage();
    const gloss = screen.getByTestId("inbox-empty-gloss-approval-gate");
    expect(gloss).toHaveTextContent("approval gate");
    expect(gloss).toHaveAttribute("title", glossaryLookup("approval gate"));
  });

  it("offers EXACTLY one call to action", () => {
    renderPage();
    const empty = screen.getByTestId("inbox-empty");
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("inbox-empty-cta")).toBeInTheDocument();
  });
});
