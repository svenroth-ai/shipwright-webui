/*
 * OrgPage.test.tsx — code-review fix: no test previously verified the
 * page's 4 presence-state branches (`loading`/`absent`/`broken`/`present`,
 * AC-6a/AC-6b/AC-7) or AC-1's fixed top-level order (chart -> shared docs ->
 * lead-card list) end-to-end through the composed page. The hook itself is
 * covered by `hooks/useOrgChartPresence.test.ts`; nav-gating consumption by
 * `SidebarNav.test.tsx`/`CommandCenter.test.tsx`. This is the missing piece:
 * `OrgPage.tsx` actually renders the right thing for each state.
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, afterEach } from "vitest";

import OrgPage from "./OrgPage";
import { useOrgChartPresence } from "../hooks/useOrgChartPresence";
import { useOrgChart } from "../hooks/useOrgChart";
import { useOrgRoster } from "../hooks/useOrgRoster";
import type { LeadRosterEntry, OrgChartView } from "../lib/orgApi";

vi.mock("../hooks/useOrgChartPresence");
vi.mock("../hooks/useOrgChart");
vi.mock("../hooks/useOrgRoster");

const mockedPresence = vi.mocked(useOrgChartPresence);
const mockedChart = vi.mocked(useOrgChart);
const mockedRoster = vi.mocked(useOrgRoster);

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

function chartQuery(overrides: Partial<ReturnType<typeof useOrgChart>> = {}) {
  return {
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    ...overrides,
  } as ReturnType<typeof useOrgChart>;
}

function rosterQuery(overrides: Partial<ReturnType<typeof useOrgRoster>> = {}) {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    ...overrides,
  } as ReturnType<typeof useOrgRoster>;
}

function renderPage() {
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

describe("OrgPage — presence-state branches", () => {
  it("shows a loading state while presence is still resolving", () => {
    mockedPresence.mockReturnValue("loading");
    mockedChart.mockReturnValue(chartQuery());
    mockedRoster.mockReturnValue(rosterQuery());
    renderPage();
    expect(screen.queryByTestId("org-page-not-installed")).toBeNull();
    expect(screen.queryByTestId("org-page-broken")).toBeNull();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows the not-installed empty state on a confirmed absent (AC-6b)", () => {
    mockedPresence.mockReturnValue("absent");
    mockedChart.mockReturnValue(chartQuery());
    mockedRoster.mockReturnValue(rosterQuery());
    renderPage();
    expect(screen.getByTestId("org-page-not-installed")).toBeInTheDocument();
  });

  it("shows a page-level error naming the failure when broken, not a blank/broken screen (AC-7)", () => {
    mockedPresence.mockReturnValue("broken");
    mockedChart.mockReturnValue(chartQuery({ error: new Error("org_chart_invalid") }));
    mockedRoster.mockReturnValue(rosterQuery());
    renderPage();
    const banner = screen.getByTestId("org-page-broken");
    expect(banner).toHaveTextContent("org_chart_invalid");
  });

  it("renders chart -> shared docs -> lead list, in that fixed order, once present (AC-1)", async () => {
    mockedPresence.mockReturnValue("present");
    mockedChart.mockReturnValue(chartQuery({ data: CHART, isSuccess: true }));
    mockedRoster.mockReturnValue(rosterQuery({ data: { leads: [LEAD] } }));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("org-lead-list")).toBeInTheDocument());
    const chart = screen.getByTestId("org-chart");
    const sharedDocs = screen.getByTestId("org-shared-docs");
    const leadList = screen.getByTestId("org-lead-list");

    // DOM order, not just presence — AC-1's block order is a promise, never
    // a coincidence of how each block happens to render.
    // eslint-disable-next-line no-bitwise
    expect(chart.compareDocumentPosition(sharedDocs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(sharedDocs.compareDocumentPosition(leadList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId("lead-card")).toHaveLength(1);
  });
});
