/*
 * TriageDetailModal.fileViewer.test.tsx — file-mention/evidence link wiring
 * (iterate-2026-08-29-compliance-file-viewer). Kept as a sibling file rather
 * than appended to TriageDetailModal.test.tsx, which is already grandfathered
 * over the bloat ceiling (limit 300, baseline current 438) — adding here
 * would have ratcheted it further.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../external/SmartViewer", () => ({
  SmartViewer: ({ path }: { path: string | null }) => (
    <div data-testid="smart-viewer-mock">{path}</div>
  ),
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
    actions: [{ id: "new-task", label: "New task", kind: "external_launch" }],
    phases: [],
    defaults: { autonomy: "guided" },
    preview: { enabled: false },
  },
  isLoading: false,
};

describe("TriageDetailModal — file viewer panel (iterate-2026-08-29-compliance-file-viewer)", () => {
  beforeEach(() => {
    useProjectActionsSpy.mockReset();
    useProjectActionsSpy.mockReturnValue(catalogReady);
  });

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

  it("evidencePath renders as a clickable link that opens the file panel", () => {
    renderModal({ evidencePath: "client/src/pages/TaskBoardPage.tsx" });
    expect(screen.queryByTestId("triage-file-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("triage-file-link"));

    const panel = screen.getByTestId("triage-file-panel");
    expect(panel).toBeTruthy();
    expect(screen.getByTestId("smart-viewer-mock")).toHaveTextContent(
      "client/src/pages/TaskBoardPage.tsx",
    );
  });

  it("a file mention detected inside the detail text opens the same panel", () => {
    renderModal({
      evidencePath: null,
      detail: "architecture.md has no shipwright:architecture marker",
    });
    fireEvent.click(screen.getByTestId("triage-file-link"));
    expect(screen.getByTestId("smart-viewer-mock")).toHaveTextContent("architecture.md");
  });

  it("closing the panel returns to the single-column layout", () => {
    renderModal({ evidencePath: "CLAUDE.md" });
    fireEvent.click(screen.getByTestId("triage-file-link"));
    expect(screen.getByTestId("triage-file-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("triage-file-panel-close"));
    expect(screen.queryByTestId("triage-file-panel")).toBeNull();
  });

  it("detail with no recognizable file mention renders plain text, no link", () => {
    renderModal({ evidencePath: null, detail: "nothing to see here" });
    expect(screen.queryByTestId("triage-file-link")).toBeNull();
    expect(screen.getByTestId("triage-detail-body")).toHaveTextContent(
      "nothing to see here",
    );
  });

  it("switching to a different triage item closes any file panel left open on the previous one", () => {
    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={{ ...baseItem, evidencePath: "CLAUDE.md" }}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("triage-file-link"));
    expect(screen.getByTestId("triage-file-panel")).toBeTruthy();

    rerender(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={{ ...baseItem, id: "trg-different-item", evidencePath: "architecture.md" }}
        />
      </Wrapper>,
    );
    expect(screen.queryByTestId("triage-file-panel")).toBeNull();
  });

  it("closing and reopening the modal on the same item does not resurrect the previous file panel", () => {
    const Wrapper = makeWrapper();
    const item = { ...baseItem, evidencePath: "CLAUDE.md" };
    const { rerender } = render(
      <Wrapper>
        <TriageDetailModal open={true} onOpenChange={vi.fn()} projectId="proj-a" item={item} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("triage-file-link"));
    expect(screen.getByTestId("triage-file-panel")).toBeTruthy();

    rerender(
      <Wrapper>
        <TriageDetailModal open={false} onOpenChange={vi.fn()} projectId="proj-a" item={item} />
      </Wrapper>,
    );
    rerender(
      <Wrapper>
        <TriageDetailModal open={true} onOpenChange={vi.fn()} projectId="proj-a" item={item} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("triage-file-panel")).toBeNull();
  });
});
