// @covers FR-01.30
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import TriagePage from "./TriagePage";
import type { TriageItem } from "../lib/triageApi";

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({
    data: [
      {
        id: "proj-a",
        name: "Project A",
        path: "/tmp/proj-a",
        profile: "vite-hono",
        status: "active",
        createdAt: "",
        lastActive: "",
        settings: { color: "#abc" },
      },
    ],
    isLoading: false,
  }),
}));

type Status = {
  projectId: string;
  isLoading: boolean;
  isError: boolean;
  behind: number | null;
  originAvailable: boolean;
  refetch: () => void;
};
let aggregate: { entries: { projectId: string; item: TriageItem }[]; statuses: Status[] } = {
  entries: [],
  statuses: [],
};
const mockUseTriageDrift = vi.fn();

vi.mock("../components/external/ProjectFilterDropdown", () => ({
  ProjectFilterDropdown: () => <div data-testid="project-filter-dropdown" />,
}));
vi.mock("../hooks/useProjectActions", () => ({
  useProjectActions: () => ({ isLoading: false, data: undefined }),
}));
vi.mock("../hooks/useStartCampaign", () => ({
  useStartCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useTriage", () => ({
  useAllTriageItems: () => aggregate,
  useTriageDrift: (...args: unknown[]) => mockUseTriageDrift(...args),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAmendTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriageDisplayItem: (_projectId: string, item: unknown) => item,
}));

function setItems(items: TriageItem[], status: Partial<Status> = {}) {
  aggregate = {
    entries: items.map((item) => ({ projectId: "proj-a", item })),
    statuses: [
      {
        projectId: "proj-a",
        isLoading: false,
        isError: false,
        behind: 0,
        originAvailable: true,
        refetch: vi.fn(),
        ...status,
      },
    ],
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function renderPage() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={["/triage"]}>
        <TriagePage />
      </MemoryRouter>
    </Wrapper>,
  );
}

const mockItem = (id: string, status = "triage"): TriageItem => ({
  id,
  ts: "2026-05-13T08:01:00Z",
  originalTs: "2026-05-13T08:01:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: `Item ${id}`,
  detail: `Detail for ${id}`,
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: `phaseQuality:${id}`,
  status: status as "triage",
  suggestedPriority: "P1",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
  revisitAt: null,
  revisitDue: false,
  amendedBy: null,
  amendedAt: null,
});

// @covers FR-01.30
describe("TriagePage", () => {
  beforeEach(() => {
    aggregate = { entries: [], statuses: [] };
    mockUseTriageDrift.mockReset();
    mockUseTriageDrift.mockReturnValue({ data: { available: true, behind: 0 } });
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("renders empty state when there is nothing open or parked", async () => {
    setItems([]);
    renderPage();
    expect(await screen.findByTestId("triage-empty-state")).toHaveTextContent("No triage items pending. ✓");
  });

  it("renders item cards in one aggregated list", async () => {
    setItems([mockItem("trg-aaaa1111"), mockItem("trg-bbbb2222")]);
    renderPage();
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(await screen.findByTestId("triage-item-trg-bbbb2222")).toBeInTheDocument();
    expect(screen.getByTestId("triage-header-count")).toHaveTextContent("(2)");
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });

  it("shows the three summary tiles with their counts", async () => {
    setItems([mockItem("trg-aaaa1111"), mockItem("trg-parked01", "snoozed")]);
    renderPage();
    expect(await screen.findByTestId("triage-tile-open")).toHaveTextContent("1");
    expect(screen.getByTestId("triage-tile-attn")).toHaveTextContent("Critical + High");
    expect(screen.getByTestId("triage-tile-parked")).toHaveTextContent("1");
  });

  it("hides the empty state when there are zero open items but a dateless park exists", async () => {
    setItems([mockItem("trg-parked01", "snoozed")]);
    renderPage();
    expect(await screen.findByTestId("triage-parked-section")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });

  it("renders item with XSS-unsafe title as plain text (not as HTML)", async () => {
    const malicious = mockItem("trg-aaaa1111");
    malicious.title = "<script>alert(1)</script>";
    malicious.detail = "<img src=x onerror=alert(2)>";
    setItems([malicious]);
    renderPage();
    const card = await screen.findByTestId("triage-item-trg-aaaa1111");
    expect(card.textContent).toContain("<script>alert(1)</script>");
    expect(card.querySelector("script")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
  });

  it("clicking an item title opens the detail modal", async () => {
    setItems([mockItem("trg-aaaa1111")]);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Item trg-aaaa1111" }));
    expect(await screen.findByTestId("triage-detail-modal")).toBeInTheDocument();
    expect(screen.getByTestId("triage-detail-body")).toHaveTextContent("Detail for trg-aaaa1111");
  });

  it("shows the staleness banner when the local checkout is behind origin", async () => {
    setItems([mockItem("trg-aaaa1111")], { behind: 3 });
    renderPage();
    expect(await screen.findByTestId("triage-stale-banner-proj-a")).toHaveTextContent(
      "3 commits behind origin",
    );
  });

  it("hides the staleness banner when in sync (behind 0) or when behind is unknown", async () => {
    setItems([mockItem("trg-aaaa1111")], { behind: 0 });
    const first = renderPage();
    await screen.findByTestId("triage-item-trg-aaaa1111");
    expect(screen.queryByTestId("triage-stale-banner-proj-a")).not.toBeInTheDocument();
    first.unmount();
    setItems([mockItem("trg-aaaa1111")], { behind: null, originAvailable: false });
    renderPage();
    await screen.findByTestId("triage-item-trg-aaaa1111");
    expect(screen.queryByTestId("triage-stale-banner-proj-a")).not.toBeInTheDocument();
  });

  it("adds a ghost-risk note only when origin is unavailable (degraded)", async () => {
    setItems([mockItem("trg-aaaa1111")], { behind: 2, originAvailable: false });
    renderPage();
    const banner = await screen.findByTestId("triage-stale-banner-proj-a");
    expect(banner).toHaveTextContent("2 commits behind origin");
    expect(banner).toHaveTextContent("already-dismissed items may still appear");
  });

  it("a failed load shows the error block with Retry, not an empty page", async () => {
    setItems([], { isError: true });
    renderPage();
    expect(await screen.findByTestId("triage-load-error-proj-a")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });

  it("a ticked filter that hides everything shows the all-filtered-out message and Clear restores the list", async () => {
    setItems([
      mockItem("trg-aaaa1111"),
      mockItem("trg-bbbb2222"),
      mockItem("trg-cccc3333", "dismissed"),
    ]);
    renderPage();
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("triage-filter-menu-trigger"));
    // Both items are "high"; ticking "low" (shown because severities have
    // fixed options) narrows the list to nothing.
    await user.click(await screen.findByTestId("triage-filter-severities-low"));

    const message = await screen.findByTestId("triage-all-filtered-out");
    expect(message).toHaveTextContent("2 hidden by the current view");
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("triage-all-filtered-out-clear"));
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-all-filtered-out")).not.toBeInTheDocument();
  });

  it("a dated, not-yet-due park is hidden by default with a hint, not reported as an active filter", async () => {
    setItems([{ ...mockItem("trg-parked01", "snoozed"), revisitAt: "2099-09-01" }]);
    renderPage();
    expect(await screen.findByTestId("triage-parked-hidden-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-item-trg-parked01")).not.toBeInTheDocument();
    // Only a hidden park remains: no filter is active, so no "filtered out" block.
    expect(screen.queryByTestId("triage-all-filtered-out")).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-empty-state")).toBeInTheDocument();
  });

  it("search appears only above 12 open items", async () => {
    setItems(Array.from({ length: 12 }, (_, i) => mockItem(`trg-${String(i).padStart(8, "0")}`)));
    const first = renderPage();
    await screen.findByTestId("triage-tiles");
    expect(screen.queryByTestId("triage-search")).not.toBeInTheDocument();
    first.unmount();
    setItems(Array.from({ length: 13 }, (_, i) => mockItem(`trg-${String(i).padStart(8, "0")}`)));
    renderPage();
    expect(await screen.findByTestId("triage-search")).toBeInTheDocument();
  });
});
