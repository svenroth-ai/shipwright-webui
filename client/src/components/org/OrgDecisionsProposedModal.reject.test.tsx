import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";
import { fetchProposedDecisions, countersignDecision } from "../../lib/orgDecisionsApi";
import { rejectDecision, fetchRejectedKeys, type RejectResult } from "../../lib/orgRejectApi";

vi.mock("../../lib/orgDecisionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgDecisionsApi")>();
  return { ...actual, fetchProposedDecisions: vi.fn(), countersignDecision: vi.fn() };
});
vi.mock("../../lib/orgRejectApi", () => ({ rejectDecision: vi.fn(), fetchRejectedKeys: vi.fn() }));

const mockedFetch = vi.mocked(fetchProposedDecisions);
const res = (entries: Awaited<ReturnType<typeof fetchProposedDecisions>>["entries"]) => ({ entries, skipped: { count: 0, leadIds: [] as string[] } });
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
const ENTRY = {
  timestamp: TS,
  leadId: "acme-lead",
  block: `<!-- decisionKey: use-weekly-digest -->\n## Proposed ${TS} — use-weekly-digest\n`,
  body: "text",
  evidence: null,
};
const ROW = `${TS}|acme-lead|0`;

describe("OrgDecisionsProposedModal - reject (W3)", () => {
  // @covers FR-01.71
  it("asks for confirmation, then rejects once even on a double click", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([ENTRY]));
    let release: (v: RejectResult) => void = () => {};
    mockedReject.mockReturnValue(new Promise((r) => { release = r; }));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-${ROW}`));
    expect(mockedReject).not.toHaveBeenCalled(); // confirmation first
    fireEvent.change(screen.getByTestId(`org-decisions-proposed-reject-reason-${ROW}`), { target: { value: "too vague" } });
    const confirm = screen.getByTestId(`org-decisions-proposed-reject-confirm-btn-${ROW}`);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockedReject).toHaveBeenCalledTimes(1);
    expect(mockedReject).toHaveBeenCalledWith(TS, "acme-lead", "too vague", expect.stringMatching(/^[0-9a-f]{32}$/));

    release({ ok: true, alreadyRejected: false, recorded: true });
    // The row is gone at once (even if a stale refetch still lists it); a quote-free notice stays.
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-notice")).toHaveTextContent(`Rejected: acme-lead, ${TS}. Recorded in the audit log.`));
    expect(screen.queryByTestId(`org-decisions-proposed-entry-${ROW}`)).toBeNull();
    expect(screen.queryByText("text")).toBeNull();
  });

  // @covers FR-01.71
  it("a lead without a folder shows a blocking message and keeps the entry", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([ENTRY]));
    mockedReject.mockResolvedValue({ ok: false, reason: "lead-unknown" });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-${ROW}`));
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-confirm-btn-${ROW}`));
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("Can't reject: this lead has no folder."));
    expect(screen.queryByText(/resolved elsewhere/)).toBeNull();
    expect(screen.getByTestId(`org-decisions-proposed-entry-${ROW}`)).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("approving an entry whose rejection is not finished says to use Reject", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([ENTRY]));
    mockedCountersign.mockResolvedValue({ ok: false, reason: "reject-pending" });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-countersign-${ROW}`));
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("This proposal was rejected but not removed. Use Reject to finish."));
    expect(screen.queryByText(/resolved elsewhere/)).toBeNull();
  });


  // @covers FR-01.71
  it("cancel closes the confirmation without sending anything", async () => {
    mockedKeys.mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([ENTRY]));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-${ROW}`));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByTestId(`org-decisions-proposed-reject-${ROW}`)).toBeInTheDocument();
    expect(mockedReject).not.toHaveBeenCalled();
  });


  // @covers FR-01.71
  it("marks a proposal whose key was rejected before as a repeat", async () => {
    mockedKeys.mockResolvedValue({ "acme-lead": [{ key: "use-weekly-digest", entryTimestamp: "2026-11-01T00:00:00.000Z" }] });
    mockedFetch.mockResolvedValue(res([ENTRY]));
    renderModal();
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-repeat-${ROW}`)).toBeInTheDocument());
    expect(screen.getByText("Repeat of a rejected proposal")).toBeInTheDocument();
  });


  // @covers FR-01.71
  it("no repeat badge when the rejection is of this very entry (crash leftover)", async () => {
    mockedKeys.mockResolvedValue({ "acme-lead": [{ key: "use-weekly-digest", entryTimestamp: TS }] });
    mockedFetch.mockResolvedValue(res([ENTRY]));
    renderModal();
    await waitFor(() => expect(mockedKeys).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    expect(screen.queryByTestId(`org-decisions-proposed-repeat-${ROW}`)).toBeNull();
  });


  // @covers FR-01.71
  it("no repeat badge for a different key", async () => {
    mockedKeys.mockResolvedValue({ "acme-lead": [{ key: "something-else", entryTimestamp: "2026-11-01T00:00:00.000Z" }] });
    mockedFetch.mockResolvedValue(res([ENTRY]));
    renderModal();
    await waitFor(() => expect(mockedKeys).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
    expect(screen.queryByTestId(`org-decisions-proposed-repeat-${ROW}`)).toBeNull();
  });
});
