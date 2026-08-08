/*
 * TriageDetailModal.amend.test.tsx — Edit (Amend) toggle wiring
 * (iterate-2026-08-08-triage-amend-reader, AC8/AC10). Split out as its OWN
 * file rather than appended to TriageDetailModal.test.tsx: that file is
 * already grandfathered at the bloat baseline, so new coverage gets a new
 * file per the project's extraction-over-growth convention.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriageDetailModal } from "./TriageDetailModal";
import type { TriageItem } from "../../lib/triageApi";

const { amendMutateAsyncSpy, driftDataRef } = vi.hoisted(() => ({
  amendMutateAsyncSpy: vi.fn(),
  driftDataRef: { current: { available: false, behind: null } as Record<string, unknown> },
}));
vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriageDrift: () => ({ data: driftDataRef.current }),
  useAmendTriageItem: () => ({ mutateAsync: amendMutateAsyncSpy, isPending: false }),
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
  title: "Original title",
  detail: "Original detail",
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

function renderModal(itemOverrides: Partial<TriageItem> = {}) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <TriageDetailModal
        open={true}
        onOpenChange={vi.fn()}
        projectId="proj-a"
        item={{ ...baseItem, ...itemOverrides }}
      />
    </Wrapper>,
  );
}

describe("TriageDetailModal — Edit toggle (AC8)", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue({ data: { actions: [], phases: [] }, isLoading: false });
    amendMutateAsyncSpy.mockReset();
    driftDataRef.current = { available: false, behind: null };
  });

  it("shows the pencil Edit toggle for a status===triage item", () => {
    renderModal();
    expect(screen.getByTestId("triage-edit-toggle")).toBeTruthy();
  });

  it("hides the Edit toggle for a non-triage status (dismissed)", () => {
    renderModal({ status: "dismissed" });
    expect(screen.queryByTestId("triage-edit-toggle")).toBeNull();
  });

  it("clicking Edit swaps the Detail read display for the amend form, and hides the action row", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    expect(screen.getByTestId("triage-amend-form")).toBeTruthy();
    expect(screen.queryByTestId("triage-detail-body")).toBeNull();
    expect(screen.queryByTestId("triage-dismiss")).toBeNull();
    expect(screen.queryByTestId("triage-snooze")).toBeNull();
    expect(screen.queryByTestId("triage-promote")).toBeNull();
    // Pencil hides itself while already editing — Cancel is the way out.
    expect(screen.queryByTestId("triage-edit-toggle")).toBeNull();
  });

  it("Cancel returns to the read display without amending", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    fireEvent.click(screen.getByTestId("triage-amend-cancel"));
    expect(screen.queryByTestId("triage-amend-form")).toBeNull();
    expect(screen.getByTestId("triage-detail-body")).toBeTruthy();
    expect(amendMutateAsyncSpy).not.toHaveBeenCalled();
  });

  it("Save submits the delta and returns to the read display on success", async () => {
    amendMutateAsyncSpy.mockResolvedValue({ ok: true });
    renderModal();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    fireEvent.change(screen.getByTestId("triage-amend-title"), {
      target: { value: "Corrected title" },
    });
    fireEvent.click(screen.getByTestId("triage-amend-save"));

    await waitFor(() => expect(screen.queryByTestId("triage-amend-form")).toBeNull());
    expect(amendMutateAsyncSpy).toHaveBeenCalledWith({
      triageId: "trg-cccc3333",
      title: "Corrected title",
    });
  });

  it("shows the 'last edited' provenance subtitle when amendedBy is set", () => {
    renderModal({ amendedBy: "sven", amendedAt: "2026-08-08T10:00:00Z" });
    expect(screen.getByTestId("triage-amend-provenance")).toHaveTextContent(
      "Last edited by sven",
    );
    expect(screen.getByTestId("triage-amend-provenance")).toHaveTextContent(
      "2026-08-08T10:00:00Z",
    );
  });

  it("shows no provenance subtitle when the item has never been amended", () => {
    renderModal();
    expect(screen.queryByTestId("triage-amend-provenance")).toBeNull();
  });

  it("AC9: discloses a tracked-store write when the drift signal says writes will NOT route to outbox", () => {
    driftDataRef.current = { available: false, behind: null, writesRouteToOutbox: false };
    renderModal();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    expect(screen.getByTestId("triage-amend-tracked-disclosure")).toBeTruthy();
  });

  it("AC9: shows no disclosure when writes route to the outbox (idle main)", () => {
    driftDataRef.current = { available: false, behind: null, writesRouteToOutbox: true };
    renderModal();
    fireEvent.click(screen.getByTestId("triage-edit-toggle"));
    expect(screen.queryByTestId("triage-amend-tracked-disclosure")).toBeNull();
  });
});
