/*
 * TriageDetailModal.test.tsx — dialog-shell regression guard for the
 * "match the Project Creation wizard" restyle
 * (iterate-20260515-triage-card-styling).
 *
 * iterate-2026-05-21-triage-fix-now-and-phase-slash — REPLACED the
 * iterate-2026-05-20 clipboard-copy Fix-now behaviour with "emit
 * FixNowIntent to parent". The 8 prior tests covering clipboard
 * semantics + transient confirmation + timer cleanup are deleted
 * because their subject (clipboard copy) no longer exists.
 *
 * The parent (TriagePage) owns the NewIssueModal mount — see
 * file header of TriageDetailModal.tsx for the lifecycle rationale.
 * These tests therefore assert that TriageDetailModal:
 *   (1) renders Fix-now for every status==="triage" item (AC-7)
 *   (2) invokes `onFixNow` with the correct intent for github source
 *       (AC-8) and any other source (AC-9), and closes itself (AC-10)
 *   (3) surfaces an inline failure when the catalog is missing
 *       AND does not invoke onFixNow / close (defensive)
 *
 * Routing helper drift is covered by `fixNowIntent.test.ts`.
 */
import { afterEach, beforeEach, describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriageDetailModal } from "./TriageDetailModal";
import type { FixNowIntent } from "./fixNowIntent";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { useProjectActionsSpy } = vi.hoisted(() => ({
  useProjectActionsSpy: vi.fn(),
}));
vi.mock("../../hooks/useProjectActions", () => ({
  useProjectActions: useProjectActionsSpy,
}));

const { startCampaignSpy, startCampaignPendingRef } = vi.hoisted(() => ({
  startCampaignSpy: vi.fn(),
  startCampaignPendingRef: { current: false },
}));
vi.mock("../../hooks/useStartCampaign", () => ({
  useStartCampaign: () => ({
    mutateAsync: startCampaignSpy,
    isPending: startCampaignPendingRef.current,
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
};

// Resolved catalog stub — both new-task + new-iterate present so the
// Fix-now resolver can find either.
const catalogReady = {
  data: {
    actions: [
      { id: "new-task", label: "New task", kind: "external_launch" },
      { id: "new-iterate", label: "New iterate", kind: "external_launch" },
    ],
    phases: [
      { id: "security", label: "Security", color: "#DC2626" },
    ],
    defaults: { autonomy: "guided" },
    preview: { enabled: false },
  },
  isLoading: false,
};

describe("TriageDetailModal styling", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue(catalogReady);
  });

  it("dialog surface matches the Project Creation wizard tokens", () => {
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
    const content = screen.getByTestId("triage-detail-modal");
    expect(content).toHaveClass("bg-[var(--color-surface)]");
    expect(content).toHaveClass("rounded-[var(--radius-card)]");
    expect(content).toHaveClass("shadow-[var(--shadow-card)]");
  });
});

describe("TriageDetailModal — Fix-now emits FixNowIntent (iterate-2026-05-21)", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue(catalogReady);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderModal(
    itemOverrides: Partial<TriageItem> = {},
    handlers: {
      onOpenChange?: Mock;
      onFixNow?: Mock;
    } = {},
  ) {
    const onOpenChange = handlers.onOpenChange ?? vi.fn<(open: boolean) => void>();
    const onFixNow = handlers.onFixNow ?? vi.fn<(intent: FixNowIntent) => void>();
    const Wrapper = makeWrapper();
    const utils = render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={onOpenChange}
          projectId="proj-a"
          item={{ ...baseItem, ...itemOverrides }}
          onFixNow={onFixNow}
        />
      </Wrapper>,
    );
    return { ...utils, onOpenChange, onFixNow };
  }

  it("AC-7: renders Fix-now on every status=triage item — even with no launchPayload", () => {
    renderModal({ launchPayload: null, source: "phaseQuality" });
    expect(screen.getByTestId("triage-fix-now")).toBeTruthy();
  });

  it("AC-7: renders Fix-now on a github item with empty launchPayload (was hidden previously)", () => {
    renderModal({ source: "github", launchPayload: null });
    expect(screen.getByTestId("triage-fix-now")).toBeTruthy();
  });

  it("AC-8: github source → onFixNow called with new-task + security intent + closes modal", () => {
    const { onOpenChange, onFixNow } = renderModal({
      source: "github",
      title: "GitHub security: 35 shipwright-security finding(s) (high)",
      detail: "Repo svenroth-ai/shipwright | scan output…",
      suggestedPriority: "P1",
      suggestedDomain: "engineering",
    });

    fireEvent.click(screen.getByTestId("triage-fix-now"));

    expect(onFixNow).toHaveBeenCalledTimes(1);
    const intent = onFixNow.mock.calls[0][0];
    expect(intent.action.id).toBe("new-task");
    expect(intent.initialPhaseId).toBe("security");
    expect(intent.initialTitle).toBe(
      "Fix for GitHub security: 35 shipwright-security finding(s) (high)",
    );
    expect(intent.initialDescription).toBe(
      "Repo svenroth-ai/shipwright | scan output…",
    );
    expect(intent.initialPriority).toBe("P1");
    expect(intent.initialDomain).toBe("engineering");
    // AC-10: modal closes after handing off.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("AC-9: iterate-source item → onFixNow called with new-iterate intent (no phase pre-fill)", () => {
    const { onOpenChange, onFixNow } = renderModal({
      source: "iterate",
      title: "Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale",
      detail: "Follow-up to iterate-2026-05-18-terminal-copy-paste…",
      suggestedPriority: "P2",
      suggestedDomain: "engineering",
    });

    fireEvent.click(screen.getByTestId("triage-fix-now"));

    expect(onFixNow).toHaveBeenCalledTimes(1);
    const intent = onFixNow.mock.calls[0][0];
    expect(intent.action.id).toBe("new-iterate");
    expect(intent.initialPhaseId).toBeUndefined();
    expect(intent.initialTitle).toBe(
      "Fix for Serve the WebUI over HTTPS so terminal Ctrl+V paste works over Tailscale",
    );
    expect(intent.initialDescription).toBe(
      "Follow-up to iterate-2026-05-18-terminal-copy-paste…",
    );
    expect(intent.initialPriority).toBe("P2");
    expect(intent.initialDomain).toBe("engineering");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("iterate-2026-05-22: intent.projectId is the prop projectId so TriagePage can pre-select the modal's project", () => {
    // Bug 2026-05-22: TriagePage's NewIssueModal opened with everything
    // pre-filled EXCEPT the project, because the intent didn't carry it
    // and TriagePage's onFixNow callback received projectId separately
    // but never threaded it to the modal. The intent now carries projectId
    // explicitly so a single source-of-truth (the intent) drives every
    // pre-fill — title, description, phase, priority, domain, project.
    const { onFixNow } = renderModal({ source: "github" });
    fireEvent.click(screen.getByTestId("triage-fix-now"));
    expect(onFixNow).toHaveBeenCalledTimes(1);
    expect(onFixNow.mock.calls[0][0].projectId).toBe("proj-a");
  });

  it("AC-9 regression: kind=compliance still routes to new-iterate (source-only discriminator)", () => {
    // I originally proposed kind=compliance → security. Sven UAT
    // 2026-05-21 overrode: compliance items in this repo are refactor
    // / spec-update work, NOT security findings. The pure
    // source==="github" rule is canonical.
    const { onFixNow } = renderModal({
      source: "phaseQuality",
      kind: "compliance",
    });

    fireEvent.click(screen.getByTestId("triage-fix-now"));

    expect(onFixNow).toHaveBeenCalledTimes(1);
    expect(onFixNow.mock.calls[0][0].action.id).toBe("new-iterate");
    expect(onFixNow.mock.calls[0][0].initialPhaseId).toBeUndefined();
  });

  it("Defensive: button disabled while catalog still loading", () => {
    useProjectActionsSpy.mockReturnValue({ data: undefined, isLoading: true });
    const { onOpenChange, onFixNow } = renderModal({ source: "github" });

    const btn = screen.getByTestId("triage-fix-now");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onFixNow).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Defensive: permanent-failure catalog (isLoading:false, data:undefined) surfaces inline failure", () => {
    useProjectActionsSpy.mockReturnValue({ data: undefined, isLoading: false });
    const { onOpenChange, onFixNow } = renderModal({ source: "github" });

    fireEvent.click(screen.getByTestId("triage-fix-now"));

    expect(onFixNow).not.toHaveBeenCalled();
    expect(screen.getByTestId("triage-fix-now-failure")).toBeTruthy();
    // Don't strand the user with no open modal.
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("TriageDetailModal — Start Campaign CTA (FR-01.33)", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue(catalogReady);
    startCampaignSpy.mockReset();
    startCampaignPendingRef.current = false;
  });

  function renderCampaign(
    itemOverrides: Partial<TriageItem>,
    handlers: {
      onOpenChange?: Mock;
      onNavigateToBoard?: Mock;
    } = {},
  ) {
    const onOpenChange = handlers.onOpenChange ?? vi.fn<(open: boolean) => void>();
    const onNavigateToBoard = handlers.onNavigateToBoard ?? vi.fn<() => void>();
    const Wrapper = makeWrapper();
    const utils = render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={onOpenChange}
          projectId="proj-a"
          item={{ ...baseItem, ...itemOverrides }}
          onNavigateToBoard={onNavigateToBoard}
        />
      </Wrapper>,
    );
    return { ...utils, onOpenChange, onNavigateToBoard };
  }

  it("non-campaign item shows no campaign CTA and keeps Fix-now primary", () => {
    renderCampaign({}); // baseItem has no campaignSlug
    expect(screen.queryByTestId("triage-campaign-cta")).toBeNull();
    expect(screen.getByTestId("triage-fix-now").className).toContain(
      "bg-emerald-600",
    );
  });

  it("draft campaign → renders Start Campaign and demotes Fix-now to secondary", () => {
    renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "draft",
    });
    expect(screen.getByTestId("triage-start-campaign")).toBeTruthy();
    expect(screen.queryByTestId("triage-go-to-board")).toBeNull();
    // Fix-now demoted: no emerald fill, carries the outline border token.
    const fixNow = screen.getByTestId("triage-fix-now");
    expect(fixNow.className).not.toContain("bg-emerald-600");
    expect(fixNow.className).toContain("border-[var(--color-border)]");
  });

  it("Start Campaign success → calls mutateAsync(slug), navigates, closes", async () => {
    startCampaignSpy.mockResolvedValue({
      ok: true,
      data: { slug: "2026-06-03-cleanup", status: "active" },
    });
    const { onOpenChange, onNavigateToBoard } = renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "draft",
    });

    fireEvent.click(screen.getByTestId("triage-start-campaign"));

    await vi.waitFor(() => expect(onNavigateToBoard).toHaveBeenCalledTimes(1));
    expect(startCampaignSpy).toHaveBeenCalledWith("2026-06-03-cleanup");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("triage-start-campaign-error")).toBeNull();
  });

  it("Start Campaign failure (409 already complete) → inline error, no navigate, stays open", async () => {
    startCampaignSpy.mockResolvedValue({
      ok: false,
      status: 409,
      error: "campaign_already_complete",
      message: "Campaign is already complete.",
    });
    const { onOpenChange, onNavigateToBoard } = renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "draft",
    });

    fireEvent.click(screen.getByTestId("triage-start-campaign"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("triage-start-campaign-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("triage-start-campaign-error").textContent).toContain(
      "Campaign is already complete.",
    );
    expect(onNavigateToBoard).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Start Campaign transport failure (rejected mutateAsync) → inline error, no navigate, stays open", async () => {
    startCampaignSpy.mockRejectedValue(new Error("network down"));
    const { onOpenChange, onNavigateToBoard } = renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "draft",
    });

    fireEvent.click(screen.getByTestId("triage-start-campaign"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("triage-start-campaign-error")).toBeTruthy(),
    );
    expect(onNavigateToBoard).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("active campaign → Go to board navigates + closes WITHOUT a status write", () => {
    const { onOpenChange, onNavigateToBoard } = renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "active",
    });

    expect(screen.queryByTestId("triage-start-campaign")).toBeNull();
    fireEvent.click(screen.getByTestId("triage-go-to-board"));

    expect(startCampaignSpy).not.toHaveBeenCalled();
    expect(onNavigateToBoard).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("complete campaign → shows complete note, no Start / Go button, Fix-now stays primary", () => {
    renderCampaign({
      campaignSlug: "2026-06-03-cleanup",
      campaignStatus: "complete",
    });
    expect(screen.getByTestId("triage-campaign-complete")).toBeTruthy();
    expect(screen.queryByTestId("triage-start-campaign")).toBeNull();
    expect(screen.queryByTestId("triage-go-to-board")).toBeNull();
    // No competing primary → Fix-now keeps its emerald primary styling.
    expect(screen.getByTestId("triage-fix-now").className).toContain(
      "bg-emerald-600",
    );
  });
});
