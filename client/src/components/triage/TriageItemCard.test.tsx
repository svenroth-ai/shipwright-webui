/*
 * TriageItemCard.test.tsx — the solid card (styling guard from
 * iterate-20260515-triage-card-styling) plus the actions it now carries
 * (iterate-2026-11-08-triage-page-redesign): primary CTA, Promote, Snooze,
 * Dismiss, quick edit, per-check help and the read-only parked footer.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TriageItemCard } from "./TriageItemCard";
import type { TriageItem } from "../../lib/triageApi";

const dismissMutate = vi.fn(async () => ({ ok: true }));

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: dismissMutate, isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAmendTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriageDrift: () => ({ data: { available: true, behind: 0 } }),
}));
vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: () => ({
    isLoading: false,
    data: {
      actions: [
        { id: "new-iterate", label: "New iterate" },
        { id: "new-task", label: "New task" },
      ],
    },
  }),
}));
vi.mock("../../hooks/useStartCampaign", () => ({
  useStartCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const item: TriageItem = {
  id: "trg-bbbb2222",
  ts: "2026-05-14T09:00:00Z",
  originalTs: "2026-05-14T09:00:00Z",
  source: "compliance",
  severity: "medium",
  kind: "maintenance",
  title: "Traceability matrix drift",
  detail: "FR-01.30 maps to a stale file path.",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: "compliance:matrix",
  status: "triage",
  suggestedPriority: "P2",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
  revisitAt: null,
  revisitDue: false,
  amendedBy: null,
  amendedAt: null,
};

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mount(over: Partial<TriageItem> = {}, handlers: Partial<Record<"onOpen" | "onFixNow" | "onNavigateToBoard", () => void>> = {}) {
  const props = {
    projectId: "proj-a",
    item: { ...item, ...over },
    onOpen: vi.fn(),
    onFixNow: vi.fn(),
    onNavigateToBoard: vi.fn(),
    ...handlers,
  };
  render(<TriageItemCard {...props} />, { wrapper: wrap });
  return props;
}

// @covers FR-01.30
describe("TriageItemCard styling", () => {
  it("renders on the white --color-surface with a resting shadow (not beige-on-beige)", () => {
    mount();
    const card = screen.getByTestId(`triage-item-${item.id}`);
    expect(card).toHaveClass("bg-[var(--color-surface)]");
    expect(card).toHaveClass("shadow-[var(--shadow-sm)]");
    expect(card).toHaveClass("border-[var(--color-border)]");
    expect(card).toHaveClass("hover:shadow-[var(--shadow-card-hover)]");
  });
});

// @covers FR-01.30
describe("TriageItemCard — Returned badge (AC8, iterate-2026-08-08-triage-filters-sort-parked)", () => {
  it("shows no Returned badge for an ordinary item", () => {
    mount();
    expect(screen.queryByTestId("triage-returned-badge")).not.toBeInTheDocument();
  });

  it("shows the Returned badge when the item's park just came due", () => {
    mount({ revisitDue: true, revisitAt: "2026-08-01" });
    expect(screen.getByTestId("triage-returned-badge")).toBeInTheDocument();
  });
});

// @covers FR-01.30
describe("TriageItemCard — actions (iterate-2026-11-08-triage-page-redesign)", () => {
  it("clicking the title opens the detail", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: item.title }));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
  });

  it("clicking an action button does NOT also open the detail", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId(`triage-card-promote-${item.id}`));
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it("clicking inside the open Promote dialog does NOT open the detail", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId(`triage-card-promote-${item.id}`));
    fireEvent.click(screen.getByRole("dialog"));
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it("Fix now hands the intent up bound to the entry's own project", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId(`triage-card-fix-now-${item.id}`));
    expect(p.onFixNow).toHaveBeenCalledTimes(1);
    expect((p.onFixNow as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe("proj-a");
  });

  it("Dismiss flips the item for its own project", async () => {
    mount();
    fireEvent.click(screen.getByTestId(`triage-card-dismiss-${item.id}`));
    await Promise.resolve();
    expect(dismissMutate).toHaveBeenCalledWith({ triageId: item.id, reason: null });
  });

  it("a campaign item offers Start campaign instead of Fix now", () => {
    mount({ campaignSlug: "camp-1", campaignStatus: "draft" });
    expect(screen.getByTestId(`triage-card-start-campaign-${item.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`triage-card-fix-now-${item.id}`)).toBeNull();
  });

  it("an active campaign offers Go to board", () => {
    const p = mount({ campaignSlug: "camp-1", campaignStatus: "active" });
    fireEvent.click(screen.getByTestId(`triage-card-go-to-board-${item.id}`));
    expect(p.onNavigateToBoard).toHaveBeenCalledWith("proj-a");
  });

  it("lists each audit check of a compliance bundle on its own line with a help button", () => {
    mount({
      detail: "Compliance: 2 open finding(s)\n- B/B7: Orphan FR — detail | hint: fix it\n- C/C1: Design manifest — x",
    });
    const list = screen.getByTestId(`triage-item-${item.id}-findings`);
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list).toHaveTextContent("B/B7");
    expect(list).toHaveTextContent("C/C1");
  });

  it("explains the severity with a help marker", () => {
    mount();
    expect(screen.getByTestId("triage-help-severity-medium")).toBeInTheDocument();
  });

  it("shows the project label only when given", () => {
    const props = {
      projectId: "proj-a",
      item,
      projectLabel: "alpha",
      onOpen: vi.fn(),
      onFixNow: vi.fn(),
      onNavigateToBoard: vi.fn(),
    };
    render(<TriageItemCard {...props} />, { wrapper: wrap });
    expect(screen.getByTestId(`triage-item-${item.id}-project`)).toHaveTextContent("alpha");
  });

  it("a parked item is read-only and says when it returns", () => {
    mount({ status: "snoozed", revisitAt: "2026-12-01" });
    expect(screen.queryByTestId(`triage-card-fix-now-${item.id}`)).toBeNull();
    expect(screen.getByTestId(`triage-deferred-item-${item.id}-revisit`)).toHaveTextContent("returns on 2026-12-01");
  });
});
