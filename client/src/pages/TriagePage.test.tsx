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
const taskLinks = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("../hooks/useTriageTaskLinks", () => ({
  useTriageTaskLinks: () => taskLinks.map,
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
    taskLinks.map = new Map();
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

  it("lines the pills, ONE behind-origin alert and the plain-text severity legend up in one summary row", async () => {
    setItems([mockItem("trg-aaaa1111")], { behind: 2 });
    renderPage();
    const summary = await screen.findByTestId("triage-summary");
    expect(summary).toContainElement(screen.getByTestId("triage-tile-open"));
    const chip = screen.getByTestId("triage-behind-alert");
    expect(summary).toContainElement(chip);
    // a short notice that never wraps, square-ish where the pills are fully round
    expect(chip).toHaveTextContent("A project behind origin");
    expect(chip.className).toContain("whitespace-nowrap");
    expect(chip.className).not.toContain("rounded-full");
    expect(screen.getByTestId("triage-tile-open").className).toContain("rounded-full");
    expect(summary).toContainElement(screen.getByTestId("triage-severity-legend"));
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

  it("the In progress tile counts items with a Fix-now task and narrows the list to them", async () => {
    setItems([mockItem("trg-aaaa1111"), mockItem("trg-bbbb2222")]);
    taskLinks.map = new Map([
      ["proj-a:trg-aaaa1111", { taskId: "t1", title: "Fix it", state: "active", projectId: "proj-a" }],
    ]);
    renderPage();
    const tile = await screen.findByTestId("triage-tile-prog");
    expect(tile).toHaveTextContent("1");
    expect(tile).toHaveTextContent("In progress");
    await userEvent.click(tile);
    expect(screen.getByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-item-trg-bbbb2222")).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-chip-tile")).toHaveTextContent("In progress");
    await userEvent.click(screen.getByLabelText("Remove tile filter"));
    expect(screen.getByTestId("triage-item-trg-bbbb2222")).toBeInTheDocument();
  });

  it("the In progress tile shows 0 when no task is linked", async () => {
    setItems([mockItem("trg-aaaa1111")]);
    renderPage();
    expect(await screen.findByTestId("triage-tile-prog")).toHaveTextContent("0");
  });
});
