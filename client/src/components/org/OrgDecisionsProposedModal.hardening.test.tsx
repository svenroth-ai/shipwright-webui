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
const none = { count: 0, leadIds: [] as string[] };

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
const mk = (ts: string, block = `## [${ts}] acme-lead\nBody.\n`) => ({ timestamp: ts, leadId: "acme-lead", block, body: "Body.\n", evidence: null });
const ENTRY = mk(TS);
const ROW = `${TS}|acme-lead|0`;

async function listed() {
  await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-list")).toBeInTheDocument());
}
function rejectRow(row = ROW) {
  fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-${row}`));
  fireEvent.click(screen.getByTestId(`org-decisions-proposed-reject-confirm-btn-${row}`));
}

describe("OrgDecisionsProposedModal - hardening", () => {
  // @covers FR-01.71
  it("shows ONE status line for skipped entries: count and lead ids, no content", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: { count: 3, leadIds: ["a-lead", "b-lead"] } });
    renderModal();
    await listed();
    const line = screen.getByTestId("org-decisions-proposed-skipped");
    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveTextContent("3 entries could not be read and were skipped (lead: a-lead, b-lead).");
  });

  // @covers FR-01.71
  it("says nothing when nothing was skipped, and uses the singular for one", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    const { unmount } = renderModal();
    await listed();
    expect(screen.queryByTestId("org-decisions-proposed-skipped")).toBeNull();
    unmount();
    mockedFetch.mockResolvedValue({ entries: [], skipped: { count: 1, leadIds: [] } });
    renderModal();
    expect(await screen.findByTestId("org-decisions-proposed-skipped")).toHaveTextContent("1 entry could not be read and was skipped.");
    expect(screen.getByTestId("org-decisions-proposed-empty")).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("entry_changed: the row says the proposal changed, nothing was approved, and the list is refetched", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    mockedCountersign.mockResolvedValue({ ok: false, reason: "entry-changed" });
    renderModal();
    await listed();
    const before = mockedFetch.mock.calls.length;
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-countersign-${ROW}`));
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("This proposal changed since you opened it — reload"));
    expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveAttribute("role", "alert");
    await waitFor(() => expect(mockedFetch.mock.calls.length).toBeGreaterThan(before));
  });

  // @covers FR-01.71
  it("entry_changed on Reject shows the same blocked message", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    mockedReject.mockResolvedValue({ ok: false, reason: "entry-changed" });
    renderModal();
    await listed();
    rejectRow();
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("This proposal changed since you opened it"));
    expect(screen.getByTestId(`org-decisions-proposed-entry-${ROW}`)).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("audit_unwritable is a blocked status that names the fix and says nothing was changed", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    const message = "acme-lead/audit.jsonl is read-only: make it writable, then retry";
    mockedCountersign.mockResolvedValue({ ok: false, reason: "audit-unwritable", message });
    mockedReject.mockResolvedValue({ ok: false, reason: "audit-unwritable", message });
    renderModal();
    await listed();
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-countersign-${ROW}`));
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent(`Nothing was changed. ${message}`));
    rejectRow();
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent(`Nothing was changed. ${message}`));
    expect(screen.getByTestId(`org-decisions-proposed-entry-${ROW}`)).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("the Rejected notice never claims a record that was not written", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: false });
    renderModal();
    await listed();
    rejectRow();
    const notice = screen.getByTestId("org-decisions-proposed-notice");
    await waitFor(() => expect(notice).toHaveTextContent("Rejected:"));
    expect(notice).not.toHaveTextContent("Recorded in the audit log");
    expect(notice).toHaveTextContent("nothing new was written");
  });

  // @covers FR-01.71
  it("an already-rejected answer says so", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue({ entries: [ENTRY], skipped: none });
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: true, recorded: false });
    renderModal();
    await listed();
    rejectRow();
    await waitFor(() => expect(screen.getByTestId("org-decisions-proposed-notice")).toHaveTextContent("Already rejected earlier"));
  });

  // @covers FR-01.71
  it("the Rejected notice is cleared when another action starts", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    const TS2 = "2026-11-20T10:30:00.000Z";
    mockedFetch.mockResolvedValue({ entries: [ENTRY, mk(TS2)], skipped: none });
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: true });
    let release: (v: Awaited<ReturnType<typeof countersignDecision>>) => void = () => {};
    mockedCountersign.mockReturnValue(new Promise((r) => { release = r; }));
    renderModal();
    await listed();
    rejectRow();
    const notice = screen.getByTestId("org-decisions-proposed-notice");
    await waitFor(() => expect(notice).toHaveTextContent("Recorded in the audit log"));
    fireEvent.click(screen.getByTestId(`org-decisions-proposed-countersign-${TS2}|acme-lead|1`));
    await waitFor(() => expect(notice.textContent).toBe(""));
    release({ ok: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001", edited: false });
  });

  // @covers FR-01.71
  it("a reject that finds the entry already countersigned pins the row like a countersign does", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValueOnce({ entries: [ENTRY], skipped: none }).mockResolvedValue({ entries: [], skipped: none });
    mockedReject.mockResolvedValue({ ok: false, reason: "already-countersigned", adr: 7 });
    renderModal();
    await listed();
    rejectRow();
    await waitFor(() => expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("Already countersigned as ADR-0007"));
    await waitFor(() => expect(mockedFetch.mock.calls.length).toBeGreaterThan(1));
    // still pinned after the refetch dropped it from the list
    expect(screen.getByTestId(`org-decisions-proposed-result-${ROW}`)).toHaveTextContent("Already countersigned as ADR-0007");
  });
});
