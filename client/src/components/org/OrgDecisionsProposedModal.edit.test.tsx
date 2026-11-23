import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { OrgDecisionsProposedModal } from "./OrgDecisionsProposedModal";
import { fetchProposedDecisions, countersignDecision } from "../../lib/orgDecisionsApi";

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

const NONCE = "3f9a1c0e5b7d42a8916c0d2e4f6a8b1c";
const TS = "2026-11-20T09:15:00.000Z";
const LINE = "Status updates go out as one weekly digest.";
const FENCED = {
  timestamp: TS,
  leadId: "acme-lead",
  block:
    `<!-- decisionKey: k1 -->\n## Proposed ${TS} — k1\n\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n[FENCED DATA — origin: acme-lead beat b1, x]\n${LINE}\n> a quote nobody should copy — acme:2026-11-19T16:02:11Z:14\n⟦SHIPWRIGHT-FENCE:${NONCE}⟧\n\n- **Lead:** acme-lead\n- **Evidence:** acme:2026-11-19T16:02:11Z:14\n`,
  body: "",
  evidence: "acme:2026-11-19T16:02:11Z:14",
};
const KEY = `org-decisions-proposed-%s-${TS}|acme-lead|0`;
const id = (name: string) => KEY.replace("%s", name);

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgDecisionsProposedModal open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("edit before approving (W4)", () => {
  // @covers FR-01.71
  it("countersign without editing sends no line (approved as proposed)", async () => {
    mockedFetch.mockResolvedValue([FENCED]);
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 1, adr: "ADR-0001", edited: false });
    renderModal();
    fireEvent.click(await screen.findByTestId(id("countersign")));
    await waitFor(() => expect(mockedCountersign).toHaveBeenCalledWith(TS, "acme-lead", undefined));
  });

  // @covers FR-01.71
  it("Edit line opens a labelled field with the line; countersign sends the edited text; the quote stays visible but is not in the field", async () => {
    mockedFetch.mockResolvedValue([FENCED]);
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 7, adr: "ADR-0007", edited: true });
    renderModal();
    fireEvent.click(await screen.findByTestId(id("edit")));
    const field = screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement;
    expect(field.value).toBe(LINE);
    expect(field.value).not.toContain("quote");
    expect(screen.getByTestId(`org-decisions-proposed-quote-${TS}|acme-lead|0-0`)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "One digest per week." } });
    fireEvent.click(screen.getByTestId(id("countersign")));
    await waitFor(() => expect(mockedCountersign).toHaveBeenCalledWith(TS, "acme-lead", "One digest per week."));
    expect(await screen.findByText(/Countersigned as ADR-0007 with your edited line/)).toBeInTheDocument();
  });

  // @covers FR-01.71
  it("'Use the original line' restores the proposed text", async () => {
    mockedFetch.mockResolvedValue([FENCED]);
    renderModal();
    fireEvent.click(await screen.findByTestId(id("edit")));
    const field = screen.getByLabelText("Line for the decisions log") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "other" } });
    fireEvent.click(screen.getByText("Use the original line"));
    expect(field.value).toBe(LINE);
  });

  // @covers FR-01.71
  it("a refused line (it copies a quote) is explained in plain words and the row stays actionable", async () => {
    mockedFetch.mockResolvedValue([FENCED]);
    mockedCountersign.mockResolvedValue({ ok: false, reason: "line-rejected", code: "line_contains_quote" });
    renderModal();
    fireEvent.click(await screen.findByTestId(id("edit")));
    fireEvent.click(screen.getByTestId(id("countersign")));
    expect(await screen.findByText(/repeats a quote from the lead/)).toBeInTheDocument();
    expect(screen.getByTestId(id("countersign"))).not.toBeDisabled();
  });

  // @covers FR-01.71
  it("an empty proposed line can still be edited, so the proposal can be approved", async () => {
    const empty = { ...FENCED, block: FENCED.block.replace(`${LINE}
`, "") };
    mockedFetch.mockResolvedValue([empty]);
    mockedCountersign.mockResolvedValue({ ok: true, alreadyCountersigned: false, number: 3, adr: "ADR-0003", edited: true });
    renderModal();
    fireEvent.click(await screen.findByTestId(id("edit")));
    fireEvent.change(screen.getByLabelText("Line for the decisions log"), { target: { value: "Written by the operator." } });
    fireEvent.click(screen.getByTestId(id("countersign")));
    await waitFor(() => expect(mockedCountersign).toHaveBeenCalledWith(TS, "acme-lead", "Written by the operator."));
  });

  // @covers FR-01.71
  it("an entry without a fenced line offers no edit button", async () => {
    mockedFetch.mockResolvedValue([{ timestamp: TS, leadId: "acme-lead", block: `## [${TS}] acme-lead\n- **Context:** a\n`, body: "- **Context:** a\n", evidence: null }]);
    renderModal();
    await screen.findByTestId(id("countersign"));
    expect(screen.queryByTestId(id("edit"))).toBeNull();
  });
});
