/*
 * TriageDetailModal layout fence — split out of TriageDetailModal.test.tsx
 * to keep that file under its bloat-baseline ceiling
 * (shipwright_bloat_baseline.json, limit 300 / current 438 at the time of
 * this split — this file carries no entry and stays well under it).
 *
 * iterate-2026-09-12-mobile-triage-form-layout — CI fence. jsdom has no
 * layout engine, so it cannot catch the actual bug (the action row
 * overflowing past the dialog's left edge on phone widths, unreachable
 * behind the ancestor's `overflow-hidden`). The behavioral proof lives in
 * e2e/flows/mobile-triage-form-layout.spec.ts. Class presence is a fence,
 * not a layout assertion — same rationale as ModalShell.test.tsx's
 * iterate-2026-07-14-more-options-flex-clip fence.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriageDetailModal } from "./TriageDetailModal";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriageDrift: () => ({ data: { available: false, behind: null } }),
  useAmendTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriageDisplayItem: (_projectId: string, item: unknown) => item,
}));

const { useProjectActionsSpy } = vi.hoisted(() => ({
  useProjectActionsSpy: vi.fn(),
}));
vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: useProjectActionsSpy,
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
  id: "trg-cccc3333",
  ts: "2026-05-14T10:00:00Z",
  originalTs: "2026-05-14T10:00:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "C1 missing phase_completed event",
  detail: "Detail body",
  evidencePath: null,
  runId: null,
  commit: null,
  dedupKey: "phaseQuality:C1",
  status: "triage",
  suggestedPriority: "P1",
  suggestedDomain: "engineering",
  statusBy: null,
  statusReason: null,
  promotedTaskId: null,
  revisitAt: null,
  revisitDue: false,
  amendedBy: null,
  amendedAt: null,
};

const catalogReady = {
  data: {
    actions: [
      { id: "new-task", label: "New task", kind: "external_launch" },
      { id: "new-iterate", label: "New iterate", kind: "external_launch" },
    ],
    phases: [{ id: "security", label: "Security", color: "#DC2626" }],
    defaults: { autonomy: "guided" },
    preview: { enabled: false },
  },
  isLoading: false,
};

describe("TriageDetailModal layout", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue(catalogReady);
  });

  // @covers FR-01.30
  it("action-button row wraps instead of overflowing past the dialog edge", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={baseItem}
        />
      </Wrapper>,
    );
    const fixNow = screen.getByTestId("triage-fix-now");
    const row = fixNow.parentElement;
    expect(row).toHaveClass("flex-wrap");
  });
});
