/*
 * AuditTimelineModal.test.tsx — cross-lead activity view. Covers: merging
 * 2+ leads' fetches, unparseable/unknown entries still rendering, a filter
 * change resetting the window, a time filter jumping straight to
 * MAX_WINDOW, lead multi-select narrowing the fetch set, and a per-lead
 * fetch failure surfacing without crashing the whole view (each lead's
 * request is independently gated exactly like the existing per-lead
 * route — a rejection for one lead must not hide the others' rows).
 */
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import { AuditTimelineModal } from "./AuditTimelineModal";
import { fetchLeadAuditLog, type AuditLogPage } from "../../lib/orgApi";

vi.mock("../../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgApi")>();
  return { ...actual, fetchLeadAuditLog: vi.fn() };
});

const mockedFetch = vi.mocked(fetchLeadAuditLog);

function pageOf(
  entries: Array<{ ts: string; kind?: string; summary?: string } | string>,
): AuditLogPage {
  const mapped = entries.map((e) => {
    if (typeof e === "string") return { raw: e, parsed: null };
    const parsed = { ts: e.ts, kind: e.kind ?? "beat_started", lead_id: "x", parent_lead_id: null, summary: e.summary };
    return { raw: JSON.stringify(parsed), parsed };
  });
  return { entries: mapped, total: mapped.length, nextCursor: null };
}

const LEADS = [
  { leadId: "lead-a", name: "Lead A" },
  { leadId: "lead-b", name: "Lead B" },
];

function renderModal(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <AuditTimelineModal open={open} onOpenChange={onOpenChange} leads={LEADS} />
    </QueryClientProvider>,
  );
  return { onOpenChange, qc };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuditTimelineModal", () => {
  it("merges rows from 2+ leads, sorted newest first", async () => {
    mockedFetch.mockImplementation((leadId) =>
      Promise.resolve(
        leadId === "lead-a"
          ? pageOf([{ ts: "2026-09-06T10:00:00.000Z", kind: "beat_completed", summary: "did a thing" }])
          : pageOf([{ ts: "2026-09-06T11:00:00.000Z", kind: "beat_started" }]),
      ),
    );
    renderModal();
    await waitFor(() => expect(screen.getAllByTestId("org-audit-timeline-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("org-audit-timeline-row");
    expect(within(rows[0]).getByText("Lead B")).toBeInTheDocument(); // newer, lead B
    expect(within(rows[1]).getByText("Lead A")).toBeInTheDocument();
    expect(within(rows[1]).getByText("did a thing")).toBeInTheDocument();
  });

  it("renders an unparseable line as raw text on expand, never dropped", async () => {
    mockedFetch.mockImplementation((leadId) =>
      Promise.resolve(leadId === "lead-a" ? pageOf(["{not json"]) : pageOf([])),
    );
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-audit-timeline-row")).toBeInTheDocument());
    expect(screen.getByText("Unparseable entry")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("org-audit-timeline-row"));
    expect(screen.getByText("{not json")).toBeInTheDocument();
  });

  it("renders an unrecognized kind by its raw string, never hidden", async () => {
    mockedFetch.mockImplementation((leadId) =>
      Promise.resolve(
        leadId === "lead-a" ? pageOf([{ ts: "2026-09-06T10:00:00.000Z", kind: "brand_new_kind" }]) : pageOf([]),
      ),
    );
    renderModal();
    await waitFor(() => expect(screen.getByText("brand_new_kind")).toBeInTheDocument());
  });

  it("lead multi-select narrows the merged view to only the selected lead", async () => {
    mockedFetch.mockImplementation((leadId) =>
      Promise.resolve(
        leadId === "lead-a"
          ? pageOf([{ ts: "2026-09-06T10:00:00.000Z" }])
          : pageOf([{ ts: "2026-09-06T11:00:00.000Z" }]),
      ),
    );
    renderModal();
    await waitFor(() => expect(screen.getAllByTestId("org-audit-timeline-row")).toHaveLength(2));
    fireEvent.click(screen.getByTestId("org-audit-timeline-lead-lead-a"));
    await waitFor(() => {
      const rows = screen.getAllByTestId("org-audit-timeline-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Lead A")).toBeInTheDocument();
    });
  });

  it("a time-window filter (Last night) jumps windowSize straight to 200, not a gradual grow", async () => {
    mockedFetch.mockResolvedValue(pageOf([]));
    renderModal();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    mockedFetch.mockClear();
    fireEvent.click(screen.getByTestId("org-audit-timeline-last-night"));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), { before: 0, limit: 200 }),
    );
  });

  it("a manual date/time range sets since/until and narrows the merge, independent of Last night", async () => {
    mockedFetch.mockImplementation((leadId) =>
      Promise.resolve(
        leadId === "lead-a"
          ? pageOf([
              { ts: "2026-09-06T10:00:00.000Z", summary: "in range" },
              { ts: "2026-09-01T10:00:00.000Z", summary: "too old" },
            ])
          : pageOf([]),
      ),
    );
    renderModal();
    await waitFor(() => expect(screen.getAllByTestId("org-audit-timeline-row")).toHaveLength(2));

    fireEvent.change(screen.getByTestId("org-audit-timeline-range-since"), {
      target: { value: "2026-09-06T00:00" },
    });
    fireEvent.change(screen.getByTestId("org-audit-timeline-range-until"), {
      target: { value: "2026-09-06T23:59" },
    });
    fireEvent.click(screen.getByTestId("org-audit-timeline-range-apply"));

    await waitFor(() => {
      const rows = screen.getAllByTestId("org-audit-timeline-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("in range")).toBeInTheDocument();
    });
    expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), { before: 0, limit: 200 });
  });

  it("changing a filter resets the window back to the default when no time filter is active", async () => {
    // Grow the window away from the default FIRST via "Load more" (external-
    // review finding: windowSize already starts at 50, so toggling a filter
    // without this step would trivially satisfy `limit: 50` even if
    // resetWindowFor never ran at all). A full 50-entry page is required so
    // hasMoreToLoad reports true and the "Load more" control renders.
    mockedFetch.mockResolvedValue(pageOf(Array.from({ length: 50 }, (_, i) => ({ ts: `2026-09-06T${String(i % 24).padStart(2, "0")}:00:00.000Z` }))));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-audit-timeline-load-more")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("org-audit-timeline-load-more"));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), { before: 0, limit: 100 }));
    mockedFetch.mockClear();

    fireEvent.click(screen.getByTestId("org-audit-timeline-lead-lead-a"));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("lead-a", { before: 0, limit: 50 }),
    );
  });

  it("a per-lead fetch failure surfaces without hiding the other lead's rows", async () => {
    mockedFetch.mockImplementation((leadId) =>
      leadId === "lead-a"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(pageOf([{ ts: "2026-09-06T10:00:00.000Z" }])),
    );
    renderModal();
    await waitFor(() => expect(screen.getByTestId("org-audit-timeline-error")).toBeInTheDocument());
    expect(screen.getByTestId("org-audit-timeline-error")).toHaveTextContent("Lead A");
    expect(screen.getByTestId("org-audit-timeline-row")).toBeInTheDocument();
  });
});
