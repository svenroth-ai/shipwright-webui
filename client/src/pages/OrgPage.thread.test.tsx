/*
 * OrgPage.thread.test.tsx — proves the FR-04.42 (V4c) thread is actually
 * mounted on the Org page, not just a component that exists unused
 * (Trap 2). `useOrgThreads` is now a real `GET /api/org/threads` query
 * (leadwright#35's producer) — mocked here the same way `useOrgRoster` and
 * `useOrgChart` already are, returning `{data, isLoading, error}`.
 * `OrgPage.test.tsx`'s AC-1 test covers the same "no thread anywhere"
 * default (AC-d) via its own mock, not the real stub this file used to
 * describe.
 */
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import OrgPage from "./OrgPage";
import { useOrgChartPresence } from "../hooks/useOrgChartPresence";
import { useOrgChart } from "../hooks/useOrgChart";
import { useOrgRoster } from "../hooks/useOrgRoster";
import { useOrgThreads } from "../hooks/useOrgThreads";
import type { LeadRosterEntry, OrgChartView } from "../lib/orgApi";
import type { OrgThreadCard } from "../components/org/OrgThread";

vi.mock("../hooks/useOrgChartPresence");
vi.mock("../hooks/useOrgChart");
vi.mock("../hooks/useOrgRoster");
vi.mock("../hooks/useOrgThreads");

const mockedPresence = vi.mocked(useOrgChartPresence);
const mockedChart = vi.mocked(useOrgChart);
const mockedRoster = vi.mocked(useOrgRoster);
const mockedThreads = vi.mocked(useOrgThreads);

const CHART: OrgChartView = {
  version: 1,
  po: "sven",
  leads: {
    "acme-lead": {
      domain: "acme",
      name: "Acme Lead",
      reports_to: null,
      manages: [],
      charter_path: "acme-lead/charter.md",
    },
  },
};

const LEAD: LeadRosterEntry = {
  leadId: "acme-lead",
  domain: "acme",
  name: "Acme Lead",
  reportsTo: null,
  role: { measured: false },
  now: { state: "not-measured" },
  cadence: { measured: false },
  usage: { leadId: "acme-lead", measured: false },
};

function renderPresentPage() {
  mockedPresence.mockReturnValue("present");
  mockedChart.mockReturnValue({ data: CHART, error: null, isPending: false, isSuccess: true } as ReturnType<
    typeof useOrgChart
  >);
  mockedRoster.mockReturnValue({ data: { leads: [LEAD] }, error: null, isLoading: false } as ReturnType<
    typeof useOrgRoster
  >);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrgPage — thread wiring (FR-04.42, V4c)", () => {
  it("renders no thread for a lead with no rounds (AC-d, real-world default)", async () => {
    mockedThreads.mockReturnValue({ data: {}, isLoading: false, error: null } as unknown as ReturnType<
      typeof useOrgThreads
    >);
    renderPresentPage();
    await waitFor(() => expect(screen.getByTestId("org-lead-list")).toBeInTheDocument());
    expect(screen.queryByTestId("org-thread-list")).toBeNull();
  });

  it("associates each lead with its OWN thread, not a neighbor's or a page-wide dump (external-review fix)", async () => {
    // Three leads: two with distinct threads, one with none — a broken
    // implementation that rendered every thread under the first card, or
    // rendered one thread list after the whole lead list, would still pass
    // a single-lead test on document order alone. This proves per-lead
    // scoping directly.
    const chart: OrgChartView = {
      version: 1,
      po: "sven",
      leads: {
        "lead-a": { domain: "a", name: "Lead A", reports_to: null, manages: [], charter_path: "lead-a/charter.md" },
        "lead-b": { domain: "b", name: "Lead B", reports_to: null, manages: [], charter_path: "lead-b/charter.md" },
        "lead-c": { domain: "c", name: "Lead C", reports_to: null, manages: [], charter_path: "lead-c/charter.md" },
      },
    };
    const leadA: LeadRosterEntry = { ...LEAD, leadId: "lead-a", domain: "a", name: "Lead A" };
    const leadB: LeadRosterEntry = { ...LEAD, leadId: "lead-b", domain: "b", name: "Lead B" };
    const leadC: LeadRosterEntry = { ...LEAD, leadId: "lead-c", domain: "c", name: "Lead C" };

    mockedPresence.mockReturnValue("present");
    mockedChart.mockReturnValue({ data: chart, error: null, isPending: false, isSuccess: true } as ReturnType<
      typeof useOrgChart
    >);
    mockedRoster.mockReturnValue({ data: { leads: [leadA, leadB, leadC] }, error: null, isLoading: false } as ReturnType<
      typeof useOrgRoster
    >);
    mockedThreads.mockReturnValue({
      data: {
        "lead-a": [{ cardId: "card-a", cardTitle: "Thread for Lead A", rounds: [{ id: "r1", question: "Q-A?", askedAt: "2026-09-01T00:00:00Z", answer: "Answer A" }] }],
        "lead-b": [{ cardId: "card-b", cardTitle: "Thread for Lead B", rounds: [{ id: "r1", question: "Q-B?", askedAt: "2026-09-01T00:00:00Z", answer: "Answer B" }] }],
        // lead-c intentionally has no entry.
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useOrgThreads>);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <OrgPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("org-thread-list")).toHaveLength(2));

    for (const [leadId, expectedTitle] of [
      ["lead-a", "Thread for Lead A"],
      ["lead-b", "Thread for Lead B"],
    ] as const) {
      const leadCard = container.querySelector(`[data-lead-id="${leadId}"]`);
      expect(leadCard).not.toBeNull();
      const wrapper = leadCard?.parentElement;
      expect(wrapper).not.toBeNull();
      const threadList = within(wrapper as HTMLElement).getByTestId("org-thread-list");
      expect(threadList).toHaveTextContent(expectedTitle);
    }

    const leadCardC = container.querySelector('[data-lead-id="lead-c"]');
    const wrapperC = leadCardC?.parentElement as HTMLElement;
    expect(within(wrapperC).queryByTestId("org-thread-list")).toBeNull();

    // And neither lead's thread text leaked into the other's wrapper.
    const wrapperA = container.querySelector('[data-lead-id="lead-a"]')?.parentElement as HTMLElement;
    expect(within(wrapperA).queryByText("Thread for Lead B")).toBeNull();
  });

  it("renders the lead's thread, below its card, in round order (AC-a)", async () => {
    const threads: Record<string, OrgThreadCard[]> = {
      "acme-lead": [
        {
          cardId: "card-1",
          cardTitle: "Follow-up",
          rounds: [
            { id: "r1", question: "First question?", askedAt: "2026-08-30T00:00:00Z", answer: "First answer" },
            { id: "r2", question: "Second question?", askedAt: "2026-08-31T00:00:00Z", answer: "Second answer" },
            { id: "r3", question: "Third question?", askedAt: "2026-09-01T00:00:00Z" },
          ],
        },
      ],
    };
    mockedThreads.mockReturnValue({ data: threads, isLoading: false, error: null } as unknown as ReturnType<
      typeof useOrgThreads
    >);
    renderPresentPage();

    await waitFor(() => expect(screen.getByTestId("org-thread-list")).toBeInTheDocument());
    const leadCard = screen.getByTestId("lead-card");
    const threadList = screen.getByTestId("org-thread-list");
    // The thread sits below its lead's card, not somewhere unrelated.
    // eslint-disable-next-line no-bitwise
    expect(leadCard.compareDocumentPosition(threadList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const rounds = screen.getAllByTestId(/^thread-round-(answered|open)$/);
    expect(rounds.map((r) => r.textContent)).toEqual([
      expect.stringContaining("First question?"),
      expect.stringContaining("Second question?"),
      expect.stringContaining("Third question?"),
    ]);
    expect(screen.getByTestId("thread-round-open")).toHaveTextContent("Third question?");
  });
});
