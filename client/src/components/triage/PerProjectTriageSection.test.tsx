/*
 * PerProjectTriageSection.test.tsx — iterate-2026-08-08-triage-filters-
 * sort-parked. Did not exist before this iterate; the component's
 * rendering logic changed materially (flat list, hidden-count line,
 * filter/sort props, the corrected unfiltered-count visibility gate).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PerProjectTriageSection } from "./PerProjectTriageSection";
import { DEFAULT_FILTER_STATE, DEFAULT_SORT_STATE, type TriageFilterState } from "../../lib/triageFilterSort";
import type { Project } from "../../types";
import type { TriageItem, TriagePriority } from "../../lib/triageApi";

const mockUseTriageItems = vi.fn();
const mockUseTriageDrift = vi.fn();

vi.mock("../../hooks/useTriage", () => ({
  useTriageItems: (...args: unknown[]) => mockUseTriageItems(...args),
  useTriageDrift: (...args: unknown[]) => mockUseTriageDrift(...args),
}));

const PROJECT: Project = {
  id: "proj-a",
  name: "Project A",
  path: "/tmp/proj-a",
  profile: "vite-hono",
  status: "active",
  createdAt: "",
  lastActive: "",
  settings: { color: "#abc" },
};

function item(overrides: Partial<TriageItem> & Pick<TriageItem, "id">): TriageItem {
  return {
    ts: "2026-06-01T08:00:00Z",
    originalTs: "2026-06-01T08:00:00Z",
    source: "phaseQuality",
    severity: "high",
    kind: "bug",
    title: "t",
    detail: "d",
    evidencePath: null,
    runId: null,
    commit: null,
    dedupKey: null,
    status: "triage",
    suggestedPriority: "P1",
    suggestedDomain: "engineering",
    statusBy: null,
    statusReason: null,
    promotedTaskId: null,
    revisitAt: null,
    revisitDue: false,
    ...overrides,
  };
}

function filters(overrides: Partial<TriageFilterState> = {}): TriageFilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

function renderSection(props: { items: TriageItem[]; filters?: TriageFilterState }) {
  mockUseTriageItems.mockReturnValue({ data: props.items, isLoading: false });
  mockUseTriageDrift.mockReturnValue({ data: { available: true, behind: 0 } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PerProjectTriageSection
        project={PROJECT}
        filters={props.filters ?? DEFAULT_FILTER_STATE}
        sort={DEFAULT_SORT_STATE}
        onFixNow={vi.fn()}
        onNavigateToBoard={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("PerProjectTriageSection", () => {
  beforeEach(() => {
    mockUseTriageItems.mockReset();
    mockUseTriageDrift.mockReset();
  });

  it("renders a flat list with no source heading", () => {
    renderSection({
      items: [item({ id: "trg-1" }), item({ id: "trg-2" })],
    });
    expect(screen.getByTestId("triage-item-trg-1")).toBeInTheDocument();
    expect(screen.getByTestId("triage-item-trg-2")).toBeInTheDocument();
    // Each card still carries its own source badge (TriageItemCard) — what's
    // gone is the old per-source GROUP heading ("phaseQuality (2)").
    expect(screen.queryByText(/phaseQuality \(2\)/i)).not.toBeInTheDocument();
  });

  it("shows the plain count when nothing is filtered", () => {
    renderSection({ items: [item({ id: "trg-1" }), item({ id: "trg-2" })] });
    expect(screen.getByTestId("triage-project-proj-a")).toHaveTextContent("Project A(2)");
  });

  it("shows 'visible of total' and the hidden-count line when a filter narrows the list", () => {
    renderSection({
      items: [
        item({ id: "trg-p1", suggestedPriority: "P1" as TriagePriority }),
        item({ id: "trg-p3", suggestedPriority: "P3" as TriagePriority }),
      ],
      filters: filters({ excludedPriorities: new Set(["P3"]) }),
    });
    expect(screen.getByTestId("triage-project-proj-a")).toHaveTextContent("Project A(1 of 2)");
    expect(screen.getByTestId("triage-hidden-count-proj-a")).toHaveTextContent("1 hidden by filter.");
    expect(screen.getByTestId("triage-item-trg-p1")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-item-trg-p3")).not.toBeInTheDocument();
  });

  it("AC5: still renders the section (heading + hidden-count line) when EVERY item is filtered out", () => {
    renderSection({
      items: [item({ id: "trg-p3", suggestedPriority: "P3" as TriagePriority })],
      filters: filters({ excludedPriorities: new Set(["P3"]) }),
    });
    expect(screen.getByTestId("triage-project-proj-a")).toBeInTheDocument();
    expect(screen.getByTestId("triage-hidden-count-proj-a")).toHaveTextContent("1 hidden by filter.");
    expect(screen.queryByTestId("triage-open-items-proj-a")).not.toBeInTheDocument();
  });

  it("renders nothing when the project genuinely has zero items (not a filtering artifact)", () => {
    const { container } = renderSection({ items: [] });
    expect(container.firstChild).toBeNull();
  });

  it("AC8: a due-parked item survives an excluding filter and shows the Returned badge", () => {
    renderSection({
      items: [
        item({ id: "trg-due", suggestedPriority: "P3" as TriagePriority, revisitDue: true }),
        item({ id: "trg-normal", suggestedPriority: "P3" as TriagePriority }),
      ],
      filters: filters({ excludedPriorities: new Set(["P3"]) }),
    });
    expect(screen.getByTestId("triage-item-trg-due")).toBeInTheDocument();
    expect(screen.queryByTestId("triage-item-trg-normal")).not.toBeInTheDocument();
    // AC8: excluded from the hidden count — it was shown, not hidden.
    expect(screen.getByTestId("triage-hidden-count-proj-a")).toHaveTextContent("1 hidden by filter.");
  });

  it("AC9: a dateless parked item stays visible in Deferred when Parked is off by default", () => {
    renderSection({
      items: [item({ id: "trg-dateless", status: "snoozed", revisitAt: null })],
    });
    expect(screen.getByTestId("triage-deferred-item-trg-dateless")).toBeInTheDocument();
  });

  it("AC7: a dated, not-due park is hidden by the Parked-off default and counted in the Deferred hidden hint", () => {
    renderSection({
      items: [item({ id: "trg-dated", status: "snoozed", revisitAt: "2099-01-01" })],
    });
    expect(screen.queryByTestId("triage-deferred-item-trg-dated")).not.toBeInTheDocument();
    expect(screen.getByTestId("triage-deferred-hidden-count")).toHaveTextContent(
      "1 parked item hidden by the current view.",
    );
  });
});
