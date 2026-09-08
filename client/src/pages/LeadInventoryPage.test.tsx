import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ReactNode } from "react";

import LeadInventoryPage from "./LeadInventoryPage";
import { fetchOrgChart } from "../lib/orgApi";
import { fetchOrgInventory } from "../lib/leadInventoryApi";
import { fetchOrgThreads } from "../lib/orgApi";
import { computeLastNightWindow } from "../lib/auditTimelineMerge";

// A timestamp guaranteed to fall inside BeatList's client-side "last night"
// window regardless of when this test happens to run.
const { sinceMs, untilMs } = computeLastNightWindow(new Date());
const WITHIN_LAST_NIGHT = new Date((sinceMs + untilMs) / 2).toISOString();

vi.mock("../lib/orgApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/orgApi")>();
  return { ...actual, fetchOrgChart: vi.fn(), fetchOrgThreads: vi.fn() };
});
vi.mock("../lib/leadInventoryApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/leadInventoryApi")>();
  return { ...actual, fetchOrgInventory: vi.fn() };
});

const mockedChart = vi.mocked(fetchOrgChart);
const mockedInventory = vi.mocked(fetchOrgInventory);
const mockedThreads = vi.mocked(fetchOrgThreads);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<LeadInventoryPage />, { wrapper });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("LeadInventoryPage", () => {
  it("renders a lead's beats, band chips, and authority panel (AC-1)", async () => {
    mockedChart.mockResolvedValue({
      version: 1,
      po: "sven",
      leads: {
        "acme-lead": { domain: "acme-lead", name: "Acme Lead", reports_to: null, manages: [], charter_path: "charter.md" },
      },
    });
    mockedThreads.mockResolvedValue({});
    mockedInventory.mockResolvedValue({
      "acme-lead": {
        leadId: "acme-lead",
        totalBeatsInRegister: 1,
        beats: [
          {
            beatId: "b1",
            startedAt: WITHIN_LAST_NIGHT,
            closedAt: null,
            steps: {
              status: "ok",
              steps: [{ at: WITHIN_LAST_NIGHT, band: "bugfix", summary: "fixed a typo", effect: { kind: "none" } }],
              unreadableLines: 0,
            },
            unclaimedEffect: { status: "clear" },
          },
        ],
        authority: {
          measured: true,
          declaredCount: 4,
          bands: [
            { id: "bugfix", name: "Bugfix", declared: true, text: "Fix small defects." },
            { id: "maintenance", name: "Maintenance", declared: true, text: "Upkeep." },
            { id: "feature", name: "Feature", declared: true, text: "Ask first." },
            { id: "architecture", name: "Architecture", declared: true, text: "Ask first." },
          ],
        },
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("lead-inventory-section-acme-lead")).toBeInTheDocument());
    expect(screen.getByText("Acme Lead")).toBeInTheDocument();
    expect(screen.getByTestId("authority-panel")).toBeInTheDocument();
    expect(screen.getByTestId("beat-list")).toBeInTheDocument();
    expect(screen.getAllByTestId("band-chip-bugfix").length).toBeGreaterThan(0);
  });

  it("shows the org-chart-broken error state without a blank page", async () => {
    mockedChart.mockRejectedValue(new Error("boom"));
    mockedThreads.mockResolvedValue({});
    mockedInventory.mockResolvedValue({});
    renderPage();
    await waitFor(() => expect(screen.getByTestId("lead-inventory-broken")).toBeInTheDocument());
  });
});
