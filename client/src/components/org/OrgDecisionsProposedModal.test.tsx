import { render, screen, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";
import { fetchProposedDecisions, countersignDecision } from "../../lib/orgDecisionsApi";
import { ApiError } from "../../lib/externalApi";

vi.mock("../../lib/orgDecisionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgDecisionsApi")>();
  return { ...actual, fetchProposedDecisions: vi.fn(), countersignDecision: vi.fn() };
});

const mockedFetch = vi.mocked(fetchProposedDecisions);
const mockedCountersign = vi.mocked(countersignDecision);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgDecisionsProposedModal open={open} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const ENTRY = {
  timestamp: "2026-08-17T09:00:00.000Z",
  leadId: "acme-lead",
  block: "## [2026-08-17T09:00:00.000Z] acme-lead\n- **Context:** a\n",
  body: "- **Context:** a\n",
  evidence: "learnings.md#2026-08-16",
};

describe("OrgDecisionsProposedModal", () => {
  it("shows an explicit 'no decisions waiting' state for an empty list — never a blank modal", async () => {
    mockedFetch.mockResolvedValue([]);
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-empty")).toBeInTheDocument());
    expect(screen.getByText("No decisions waiting.")).toBeInTheDocument();
  });

  it("renders one entry per proposal, with its lead, timestamp, and evidence pointer", async () => {
    mockedFetch.mockResolvedValue([ENTRY]);
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    const row = screen.getByTestId(`org-decisions-proposed-entry-${ENTRY.timestamp}|${ENTRY.leadId}|0`);
    expect(within(row).getAllByText(/acme-lead/).length).toBeGreaterThan(0);
    expect(within(row).getByText(/learnings\.md#2026-08-16/)).toBeInTheDocument();
  });

  it("a missing file (404) shows the not-found state, distinct from the empty-list state", async () => {
    mockedFetch.mockRejectedValue(new ApiError("not_found", 404, {}));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-not-found")).toBeInTheDocument());
  });

  it("Countersign success shows the assigned ADR number", async () => {
    mockedFetch.mockResolvedValue([ENTRY]);
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001" });
    renderModal();

    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(
      screen.getByTestId(`org-decisions-proposed-countersign-${ENTRY.timestamp}|${ENTRY.leadId}|0`),
    );

    await waitFor(() =>
      expect(screen.getByText("Countersigned as ADR-0001.")).toBeInTheDocument(),
    );
    expect(mockedCountersign).toHaveBeenCalledWith(ENTRY.timestamp, ENTRY.leadId);
  });

  it("an idempotent retry (alreadyCountersigned: true) reads as a quiet already-done state, not an error", async () => {
    mockedFetch.mockResolvedValue([ENTRY]);
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: true, number: 1, adr: "ADR-0001" });
    renderModal();

    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(
      screen.getByTestId(`org-decisions-proposed-countersign-${ENTRY.timestamp}|${ENTRY.leadId}|0`),
    );

    await waitFor(() =>
      expect(screen.getByText("Already countersigned as ADR-0001.")).toBeInTheDocument(),
    );
  });

  it("409 duplicate reads as 'resolve by hand', distinct wording from a generic error", async () => {
    mockedFetch.mockResolvedValue([ENTRY]);
    mockedCountersign.mockResolvedValue({ ok: false, reason: "duplicate", count: 2 });
    renderModal();

    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(
      screen.getByTestId(`org-decisions-proposed-countersign-${ENTRY.timestamp}|${ENTRY.leadId}|0`),
    );

    await waitFor(() =>
      expect(screen.getByText(/share this identity \(2\) — resolve by hand/)).toBeInTheDocument(),
    );
  });

  it("doubt-review fix: two entries sharing (timestamp, leadId) — the server's own duplicate_identity case — get independently addressable rows and Countersign buttons", async () => {
    const DUPLICATE_A = { ...ENTRY, body: "- **Context:** first\n", evidence: null };
    const DUPLICATE_B = { ...ENTRY, body: "- **Context:** second\n", evidence: null };
    mockedFetch.mockResolvedValue([DUPLICATE_A, DUPLICATE_B]);
    renderModal();

    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    const rowA = screen.getByTestId(`org-decisions-proposed-entry-${ENTRY.timestamp}|${ENTRY.leadId}|0`);
    const rowB = screen.getByTestId(`org-decisions-proposed-entry-${ENTRY.timestamp}|${ENTRY.leadId}|1`);
    expect(rowA).not.toBe(rowB);
    expect(within(rowA).getByText(/first/)).toBeInTheDocument();
    expect(within(rowB).getByText(/second/)).toBeInTheDocument();

    const buttonB = screen.getByTestId(`org-decisions-proposed-countersign-${ENTRY.timestamp}|${ENTRY.leadId}|1`);
    mockedCountersign.mockResolvedValue({ ok: false, reason: "duplicate", count: 2 });
    fireEvent.click(buttonB);

    await waitFor(() => expect(within(rowB).getByText(/resolve by hand/)).toBeInTheDocument());
    expect(within(rowA).queryByText(/resolve by hand/)).not.toBeInTheDocument();
  });

  it("a 404 not-found on countersign (resolved by someone else meanwhile) reads distinctly, and refetches the list", async () => {
    mockedFetch.mockResolvedValue([ENTRY]);
    mockedCountersign.mockResolvedValue({ ok: false, reason: "not-found" });
    renderModal();

    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(
      screen.getByTestId(`org-decisions-proposed-countersign-${ENTRY.timestamp}|${ENTRY.leadId}|0`),
    );

    await waitFor(() => expect(screen.getByText("Already resolved elsewhere.")).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledTimes(2); // initial load + refetch
  });
});
