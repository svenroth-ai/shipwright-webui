/*
 * PendingDelivery.test.tsx — pending-delivery badge + CTA assurance for
 * iterate-2026-06-10-triage-pending-delivery-badge (AC3 / AC4).
 *
 * An outbox-only item (`pendingDelivery: true` from the GET-route
 * enrichment mirroring `triage_cli.py list --json`) must be visibly
 * distinguishable in the list card and the detail modal, and the existing
 * Fix-now CTA must keep working on it unchanged (residence never gates the
 * intent — fixNowIntent.ts builds from item fields only).
 *
 * Lives in its own file (not TriageItemCard.test.tsx / TriageDetailModal
 * .test.tsx) so the modal test file stays inside its bloat-baseline budget.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PendingDeliveryBadge } from "./TriageBadgeUI";
import { TriageItemCard } from "./TriageItemCard";
import { TriageDetailModal } from "./TriageDetailModal";
import type { FixNowIntent } from "./fixNowIntent";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: () => ({
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

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const baseItem: TriageItem = {
  id: "trg-dddd4444",
  ts: "2026-06-10T09:00:00Z",
  originalTs: "2026-06-10T09:00:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "Fresh background finding",
  detail: "Lives only in the outbox buffer.",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: "phaseQuality:fresh",
  status: "triage",
  suggestedPriority: "P1",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
};

describe("PendingDeliveryBadge", () => {
  it("renders the label and the ships-with-next-iterate explainer tooltip", () => {
    render(<PendingDeliveryBadge />);
    const badge = screen.getByTestId("triage-pending-delivery");
    expect(badge).toHaveTextContent("pending delivery");
    expect(badge.getAttribute("title")).toMatch(/next iterate/i);
  });
});

describe("TriageItemCard pending-delivery (AC3)", () => {
  it("shows the badge for an outbox-only item", () => {
    render(
      <TriageItemCard item={{ ...baseItem, pendingDelivery: true }} onClick={vi.fn()} />,
    );
    expect(screen.getByTestId("triage-pending-delivery")).toBeInTheDocument();
  });

  it("shows NO badge for a tracked item (false) nor for a legacy un-enriched item (absent)", () => {
    const { rerender } = render(
      <TriageItemCard item={{ ...baseItem, pendingDelivery: false }} onClick={vi.fn()} />,
    );
    expect(screen.queryByTestId("triage-pending-delivery")).toBeNull();
    // External review Gem3: absent (undefined) must degrade to "not pending".
    rerender(<TriageItemCard item={baseItem} onClick={vi.fn()} />);
    expect(screen.queryByTestId("triage-pending-delivery")).toBeNull();
  });
});

describe("TriageDetailModal pending-delivery (AC3 + AC4 CTA assurance)", () => {
  function mountModal(item: TriageItem, onFixNow?: (i: FixNowIntent) => void) {
    return render(
      <TriageDetailModal
        open={true}
        onOpenChange={vi.fn()}
        projectId="proj-a"
        item={item}
        onFixNow={onFixNow}
      />,
      { wrapper: makeWrapper() },
    );
  }

  it("shows the badge in the header chip row for a pending item", () => {
    mountModal({ ...baseItem, pendingDelivery: true });
    expect(screen.getByTestId("triage-pending-delivery")).toBeInTheDocument();
  });

  it("shows NO badge for a non-pending item (layout regression fence)", () => {
    mountModal({ ...baseItem, pendingDelivery: false });
    expect(screen.queryByTestId("triage-pending-delivery")).toBeNull();
  });

  it("Fix-now stays enabled on a pending item and emits the intent (residence never gates the CTA)", () => {
    const onFixNow = vi.fn();
    mountModal({ ...baseItem, pendingDelivery: true }, onFixNow);
    const btn = screen.getByTestId("triage-fix-now");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onFixNow).toHaveBeenCalledTimes(1);
    const intent = onFixNow.mock.calls[0][0] as FixNowIntent;
    expect(intent.action.id).toBe("new-iterate");
    expect(intent.projectId).toBe("proj-a");
  });
});
