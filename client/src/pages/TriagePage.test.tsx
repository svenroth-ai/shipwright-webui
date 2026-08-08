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

const mockUseTriageItems = vi.fn();
const mockUseTriageCounts = vi.fn();
const mockUseTriageDrift = vi.fn();

vi.mock("../hooks/useTriage", () => ({
  useTriageItems: (...args: unknown[]) => mockUseTriageItems(...args),
  // Every test in this file registers exactly one project ("proj-a"), so
  // re-invoking the same configured mock per requested id reproduces the
  // same items array `useAllTriageItems` would read from the shared cache
  // in the real hook — no per-test setup duplication needed.
  useAllTriageItems: (ids: string[]) => ids.map(() => mockUseTriageItems()),
  useTriageCounts: (...args: unknown[]) => mockUseTriageCounts(...args),
  useTriageDrift: (...args: unknown[]) => mockUseTriageDrift(...args),
  usePromoteTriageItem: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDismissTriageItem: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSnoozeTriageItem: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

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
});

describe("TriagePage", () => {
  beforeEach(() => {
    mockUseTriageItems.mockReset();
    mockUseTriageCounts.mockReset();
    mockUseTriageDrift.mockReset();
    // Default: local checkout in sync with origin → no staleness banner.
    mockUseTriageDrift.mockReturnValue({ data: { available: true, behind: 0 } });
  });

  it("renders empty state when total triage count is 0", async () => {
    mockUseTriageItems.mockReturnValue({ data: [], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 0 }, total: 0 } });
    renderPage();
    expect(await screen.findByTestId("triage-empty-state")).toHaveTextContent(
      "No triage items pending. ✓",
    );
  });

  it("renders item cards as a flat list, with no source-derived group heading (AC6, iterate-2026-08-08-triage-filters-sort-parked)", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [mockItem("trg-aaaa1111"), mockItem("trg-bbbb2222")],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 2 }, total: 2 } });
    renderPage();
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(await screen.findByTestId("triage-item-trg-bbbb2222")).toBeInTheDocument();
    // The old per-source group heading ("phaseQuality (2)") is gone —
    // items render as one continuous list. Domain stays visible on each
    // card via the existing suggestedPriority/suggestedDomain inline text.
    expect(screen.queryByText(/phaseQuality \(2\)/i)).not.toBeInTheDocument();
  });

  it("hides empty state when items > 0", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [mockItem("trg-aaaa1111")],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    renderPage();
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });

  it("hides empty state when there are zero OPEN items but deferredTotal > 0 (code review fix)", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [mockItem("trg-parked01", "snoozed")],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({
      data: { counts: { "proj-a": 0 }, total: 0, deferredTotal: 1 },
    });
    renderPage();
    expect(await screen.findByTestId("triage-deferred-section")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });

  it("renders item with XSS-unsafe title as plain text (not as HTML)", async () => {
    const malicious = mockItem("trg-aaaa1111");
    malicious.title = "<script>alert(1)</script>";
    malicious.detail = "<img src=x onerror=alert(2)>";
    mockUseTriageItems.mockReturnValue({ data: [malicious], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    renderPage();
    const card = await screen.findByTestId("triage-item-trg-aaaa1111");
    // The text appears verbatim (as text content), not as an executed script
    expect(card.textContent).toContain("<script>alert(1)</script>");
    // No script element was injected
    expect(card.querySelector("script")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
  });

  it("clicking an item opens the detail modal", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [mockItem("trg-aaaa1111")],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("triage-item-trg-aaaa1111"));
    expect(await screen.findByTestId("triage-detail-modal")).toBeInTheDocument();
    expect(screen.getByTestId("triage-detail-body")).toHaveTextContent("Detail for trg-aaaa1111");
  });

  it("shows the staleness banner when the local checkout is behind origin", async () => {
    mockUseTriageItems.mockReturnValue({ data: [mockItem("trg-aaaa1111")], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    mockUseTriageDrift.mockReturnValue({ data: { available: true, behind: 3 } });
    renderPage();
    const banner = await screen.findByTestId("triage-stale-banner-proj-a");
    expect(banner).toHaveTextContent("3 commits behind origin");
  });

  it("hides the staleness banner when the checkout is in sync (behind 0)", async () => {
    mockUseTriageItems.mockReturnValue({ data: [mockItem("trg-aaaa1111")], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    mockUseTriageDrift.mockReturnValue({ data: { available: true, behind: 0 } });
    renderPage();
    await screen.findByTestId("triage-item-trg-aaaa1111");
    expect(screen.queryByTestId("triage-stale-banner-proj-a")).not.toBeInTheDocument();
  });

  it("adds a ghost-risk note only when origin is unavailable (degraded)", async () => {
    mockUseTriageItems.mockReturnValue({ data: [mockItem("trg-aaaa1111")], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    mockUseTriageDrift.mockReturnValue({ data: { available: false, behind: 2 } });
    renderPage();
    const banner = await screen.findByTestId("triage-stale-banner-proj-a");
    expect(banner).toHaveTextContent("2 commits behind origin");
    expect(banner).toHaveTextContent("already-dismissed items may still appear");
  });

  it("hides the banner when drift data is absent (older server → behind null)", async () => {
    mockUseTriageItems.mockReturnValue({ data: [mockItem("trg-aaaa1111")], isLoading: false });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 1 }, total: 1 } });
    mockUseTriageDrift.mockReturnValue({ data: { available: false, behind: null } });
    renderPage();
    await screen.findByTestId("triage-item-trg-aaaa1111");
    expect(screen.queryByTestId("triage-stale-banner-proj-a")).not.toBeInTheDocument();
  });

  it("AC5: shows the all-filtered-out message (not the genuine-empty state) when items exist but the active filters hide all of them, and its Clear-filters button restores them (code-reviewer finding #3/#8)", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [
        mockItem("trg-aaaa1111"),
        mockItem("trg-bbbb2222"),
        // Re-review finding NEW-3: a promoted/dismissed item must NOT
        // count toward the denominator (relevantCount is openItems +
        // deferredItems, never allItems.length). Every other item here is
        // status "triage", so without this fixture allItems.length ==
        // openItems.length and a regression to the wrong denominator
        // would stay invisible — with it, a wrong denominator makes
        // hiddenCount(2) != relevantCount(3) and the assertions below go
        // red instead of silently passing.
        mockItem("trg-cccc3333", "dismissed"),
      ],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({ data: { counts: { "proj-a": 2 }, total: 2 } });
    renderPage();
    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();

    const user = userEvent.setup();
    // Both open mock items are suggestedPriority "P1" — excluding it hides
    // every relevant item while relevant items still exist, so this must
    // render the distinct all-filtered-out message, not the genuine-empty
    // state.
    await user.click(await screen.findByTestId("triage-filter-priority-P1"));

    const message = await screen.findByTestId("triage-all-filtered-out");
    expect(message).toHaveTextContent("2 hidden by the active filters");
    expect(message).toHaveTextContent("clear filters");
    expect(screen.queryByTestId("triage-item-trg-aaaa1111")).not.toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("triage-all-filtered-out-clear"));

    expect(await screen.findByTestId("triage-item-trg-aaaa1111")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-all-filtered-out")).not.toBeInTheDocument();
  });

  it("does NOT show the all-filtered-out message when the only hidden items are parked-and-not-due (Parked's own default-hidden state, not an active attribute filter) — the Clear-filters button can't reveal those anyway, since DEFAULT_FILTER_STATE.showParked is false (re-review finding NEW-1: the first cut of this banner double-counted Parked-suppressed items as 'hidden by the active filters', so the Clear button it just gained would have been a no-op in this exact state)", async () => {
    mockUseTriageItems.mockReturnValue({
      data: [
        // Dated, not due — hidden by the Parked filter's own default
        // (showParked: false), independent of Priority/Domain/Complexity.
        { ...mockItem("trg-parked01", "snoozed"), revisitAt: "2026-09-01" },
      ],
      isLoading: false,
    });
    mockUseTriageCounts.mockReturnValue({
      data: { counts: { "proj-a": 0 }, total: 0, deferredTotal: 1 },
    });
    renderPage();

    // The Deferred section's own AC7 hint is the correct affordance for
    // this state — visible, with its own path to reveal the item (the
    // Parked filter chip) — not the page-level "active filters" banner.
    expect(await screen.findByTestId("triage-deferred-section")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-all-filtered-out")).not.toBeInTheDocument();
    expect(screen.queryByTestId("triage-empty-state")).not.toBeInTheDocument();
  });
});
