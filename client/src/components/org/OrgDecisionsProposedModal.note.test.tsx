import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";
import { fetchProposedDecisions, countersignDecision } from "../../lib/orgDecisionsApi";
import { rejectDecision, fetchRejectedKeys } from "../../lib/orgRejectApi";

vi.mock("../../lib/orgDecisionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgDecisionsApi")>();
  return { ...actual, fetchProposedDecisions: vi.fn(), countersignDecision: vi.fn() };
});
vi.mock("../../lib/orgRejectApi", () => ({ rejectDecision: vi.fn(), fetchRejectedKeys: vi.fn() }));

const mockedFetch = vi.mocked(fetchProposedDecisions);
const mockedCountersign = vi.mocked(countersignDecision);
const mockedReject = vi.mocked(rejectDecision);
const mockedKeys = vi.mocked(fetchRejectedKeys);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgDecisionsProposedModal open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const TS = "2026-11-20T09:15:00.000Z";
const ENTRY = { timestamp: TS, leadId: "acme-lead", block: `## [${TS}] acme-lead\n\nPlain learning.\n`, body: "\nPlain learning.\n", evidence: null };
const ROW = `${TS}|acme-lead|0`;

describe("countersign note and reject reason (iterate-2026-11-28-decision-reject-reason)", () => {
  // @covers FR-01.71
  it("Add note opens a one-line field (max 600) and countersign sends the note", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: { count: 0, leadIds: [] } });
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001", edited: false });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    expect(screen.queryByTestId(`org-decisions-proposed-note-input-${ROW}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-note-${ROW}`));
    const input = screen.getByTestId(`org-decisions-proposed-note-input-${ROW}`);
    expect(input).toHaveAttribute("maxLength", "600");
    fireEvent.change(input, { target: { value: "ship it after the review" } });
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-countersign-${ROW}`));
    await waitFor(() => expect(mockedCountersign).toHaveBeenCalledWith(TS, "acme-lead", undefined, expect.stringMatching(/^[0-9a-f]{32}$/), "ship it after the review"));
  });

  // @covers FR-01.71
  it("a refused reason blocks the row with a plain explanation; the reason field allows 600 characters", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: { count: 0, leadIds: [] } });
    mockedReject.mockResolvedValue({ ok: false, reason: "reason-rejected", code: "reason_contains_quote" });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-${ROW}`));
    expect(screen.getByTestId(`org-decisions-proposed-reject-reason-${ROW}`)).toHaveAttribute("maxLength", "600");
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-confirm-btn-${ROW}`));
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("Your reason repeats a quote from the lead"));
    expect(screen.getByTestId(`org-decisions-proposed-entry-${ROW}`)).toBeInTheDocument();
  });
});
