import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";
import { fetchProposedDecisions, countersignDecision } from "../../lib/orgDecisionsApi";
import { rejectDecision, fetchRejectedKeys } from "../../lib/orgRejectApi";
import { blockDigest } from "../../lib/orgBlockDigest";

vi.mock("../../lib/orgDecisionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgDecisionsApi")>();
  return { ...actual, fetchProposedDecisions: vi.fn(), countersignDecision: vi.fn() };
});
vi.mock("../../lib/orgRejectApi", () => ({ rejectDecision: vi.fn(), fetchRejectedKeys: vi.fn() }));

const mockedFetch = vi.mocked(fetchProposedDecisions);
const mockedCountersign = vi.mocked(countersignDecision);
const mockedReject = vi.mocked(rejectDecision);
const res = (entries: Awaited<ReturnType<typeof fetchProposedDecisions>>["entries"]) => ({ entries, skipped: { count: 0, leadIds: [] as string[] } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const TS_A = "2026-11-20T08:00:00.000Z";
const TS_B = "2026-11-20T09:15:00.000Z";
const fenced = (ts: string, line: string, key = "k1") => ({
  timestamp: ts,
  leadId: "acme-lead",
  block:
    `<!-- decisionKey: ${key} -->\n## Proposed ${ts} — ${key}\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n[FENCED DATA — origin: acme-lead beat b1, x]\n${line}\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** acme-lead\n- **Evidence:** card 1\n`,
  body: "",
  evidence: "card 1",
});
const A = fenced(TS_A, "Line of A.", "ka");
const B = fenced(TS_B, "Original line of B.");
const B2 = fenced(TS_B, "Line of B as the lead rewrote it.");
const row = (ts: string) => `${ts}|acme-lead|0`;
const tid = (name: string, ts: string) => `org-decisions-proposed-${name}-${row(ts)}`;

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgDecisionsProposedModal open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** Reject row A; the refetch that follows hands back `after`. */
async function rejectAThenRefetch(after: Parameters<typeof res>[0]) {
  vi.mocked(fetchRejectedKeys).mockResolvedValue({});
  mockedFetch.mockResolvedValueOnce(res([A, B])).mockResolvedValue(res(after));
  mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: true });
  renderModal();
  await screen.findByTestId(tid("entry", TS_A));
}
const doRejectA = () => {
  fireEvent.click(screen.getByTestId(tid("reject", TS_A)));
  fireEvent.click(screen.getByTestId(tid("reject-confirm-btn", TS_A)));
};

describe("a row whose content changed under the operator (limits closeout)", () => {
  // @covers FR-01.71
  it("shows a changed marker, blocks every decision, and sends the NEW digest only after an explicit acknowledgement", async () => {
    await rejectAThenRefetch([B2]);
    doRejectA();
    const marker = await screen.findByTestId(tid("changed", TS_B));
    expect(marker).toHaveTextContent("changed since you opened it");
    expect(screen.getByTestId(tid("countersign", TS_B))).toBeDisabled();
    expect(screen.getByTestId(tid("reject", TS_B))).toBeDisabled();
    expect(screen.getByTestId(tid("edit", TS_B))).toBeDisabled();
    expect(screen.getByTestId(tid("line", TS_B))).toHaveTextContent("Line of B as the lead rewrote it.");
    fireEvent.click(screen.getByTestId(tid("countersign", TS_B)));
    expect(mockedCountersign).not.toHaveBeenCalled();

    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 2, adr: "ADR-0002", edited: false });
    fireEvent.click(screen.getByTestId(tid("changed-ack", TS_B)));
    expect(screen.queryByTestId(tid("changed", TS_B))).toBeNull();
    fireEvent.click(screen.getByTestId(tid("countersign", TS_B)));
    await waitFor(() => expect(mockedCountersign).toHaveBeenCalledWith(TS_B, "acme-lead", "Line of B as the lead rewrote it.", blockDigest(B2.block), undefined));
  });

  // @covers FR-01.71
  it("resets the edit field to the new proposed line and flags the edit that was open", async () => {
    await rejectAThenRefetch([B2]);
    fireEvent.click(screen.getByTestId(tid("edit", TS_B)));
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "My own wording." } });
    doRejectA();
    const marker = await screen.findByTestId(tid("changed", TS_B));
    expect(marker).toHaveTextContent("Your open edit was replaced by the new proposed line.");
    fireEvent.click(screen.getByTestId(tid("changed-ack", TS_B)));
    expect((screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement).value).toBe("Line of B as the lead rewrote it.");
  });

  // @covers FR-01.71
  it("an unchanged row is untouched by another row's refetch, and keeps its state although its position moved", async () => {
    await rejectAThenRefetch([B]);
    fireEvent.click(screen.getByTestId(tid("edit", TS_B)));
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "My own wording." } });
    doRejectA();
    await waitFor(() => expect(screen.queryByTestId(tid("entry", TS_A))).toBeNull());
    expect(screen.queryByTestId(tid("changed", TS_B))).toBeNull();
    expect((screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement).value).toBe("My own wording.");
    expect(screen.getByTestId(tid("countersign", TS_B))).toBeEnabled();
  });

  // @covers FR-01.71
  it("a refetch that differs only in line endings changes nothing: no marker, the open edit is kept", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    const crlf = { ...B, block: B.block.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10)) };
    mockedFetch.mockResolvedValueOnce(res([A, B])).mockResolvedValue(res([crlf]));
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: true });
    renderModal();
    await screen.findByTestId(tid("entry", TS_A));
    fireEvent.click(screen.getByTestId(tid("edit", TS_B)));
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "My own wording." } });
    doRejectA();
    await waitFor(() => expect(screen.queryByTestId(tid("entry", TS_A))).toBeNull());
    expect(screen.queryByTestId(tid("changed", TS_B))).toBeNull();
    expect((screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement).value).toBe("My own wording.");
  });

  // @covers FR-01.71
  it("an old verdict (blocked message) is not shown on the rewritten version", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValueOnce(res([B])).mockResolvedValue(res([B2]));
    mockedCountersign.mockResolvedValue({ ok: false, reason: "line-rejected", code: "line_empty" });
    renderModal();
    fireEvent.click(await screen.findByTestId(tid("countersign", TS_B)));
    expect(await screen.findByTestId(tid("result", TS_B))).toHaveTextContent("The line is empty");
    mockedCountersign.mockResolvedValue({ ok: false, reason: "entry-changed" });
    fireEvent.click(screen.getByTestId(tid("countersign", TS_B)));
    const marker = await screen.findByTestId(tid("changed", TS_B));
    expect(marker).toBeInTheDocument();
    expect(screen.queryByTestId(tid("result", TS_B))).toBeNull();
  });
});

describe("a row that appears after the window was opened (limits closeout)", () => {
  // @covers FR-01.71
  it("is marked and locked until acknowledged, e.g. a proposal the lead re-issued under a new timestamp", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    const B3 = fenced("2026-11-20T09:16:00.000Z", "Re-issued line of B.");
    mockedFetch.mockResolvedValueOnce(res([A, B])).mockResolvedValue(res([B3]));
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: true });
    renderModal();
    await screen.findByTestId(tid("entry", TS_A));
    doRejectA();
    const marker = await screen.findByTestId(tid("changed", "2026-11-20T09:16:00.000Z"));
    expect(marker).toHaveTextContent("appeared after you opened the window");
    expect(screen.getByTestId(tid("countersign", "2026-11-20T09:16:00.000Z"))).toBeDisabled();
    fireEvent.click(screen.getByTestId(tid("changed-ack", "2026-11-20T09:16:00.000Z")));
    expect(screen.getByTestId(tid("countersign", "2026-11-20T09:16:00.000Z"))).toBeEnabled();
  });
});

describe("reject messages (limits closeout)", () => {
  // @covers FR-01.71
  it("a reject on an entry whose audit record is missing says so instead of 'already countersigned'", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([B]));
    mockedReject.mockResolvedValue({ ok: false, reason: "audit-pending", adr: 3, message: "Logged, but the audit record is missing: fix the lead's audit file" });
    renderModal();
    fireEvent.click(await screen.findByTestId(tid("reject", TS_B)));
    fireEvent.click(screen.getByTestId(tid("reject-confirm-btn", TS_B)));
    const result = await screen.findByTestId(tid("result", TS_B));
    expect(result).toHaveTextContent("Logged as ADR-0003, but its audit record is missing");
    expect(result).toHaveTextContent("Nothing was rejected");
    expect(result).not.toHaveTextContent("Already countersigned");
  });

  // @covers FR-01.71
  it("a reject whose retry reason was dropped says which reason is on record", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([B]));
    mockedReject.mockResolvedValue({ ok: true, alreadyRejected: false, recorded: false, existingReason: "too vague" });
    renderModal();
    fireEvent.click(await screen.findByTestId(tid("reject", TS_B)));
    fireEvent.click(screen.getByTestId(tid("reject-confirm-btn", TS_B)));
    await waitFor(() =>
      expect(screen.getByTestId("org-decisions-proposed-notice")).toHaveTextContent(/audit record already exists in the lead.s audit file \(with the reason "too vague"\); the audit record keeps that reason/),
    );
  });

  // @covers FR-01.71
  it("a duplicate with an earlier logged version tells the operator that Reject removes it", async () => {
    vi.mocked(fetchRejectedKeys).mockResolvedValue({});
    mockedFetch.mockResolvedValue(res([B]));
    mockedCountersign.mockResolvedValue({ ok: false, reason: "duplicate", count: 2, loggedAdr: "ADR-0004" });
    renderModal();
    fireEvent.click(await screen.findByTestId(tid("countersign", TS_B)));
    const result = await screen.findByTestId(tid("result", TS_B));
    expect(result).toHaveTextContent("already logged as ADR-0004");
    expect(result).toHaveTextContent("Use Reject");
  });
});
