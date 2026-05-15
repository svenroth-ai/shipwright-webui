/*
 * TriageDetailModal.test.tsx — dialog-shell regression guard for the
 * "match the Project Creation wizard" restyle
 * (iterate-20260515-triage-card-styling).
 *
 * Pins the Radix Dialog content to the same design tokens ProjectWizard
 * uses: white `--color-surface`, `--radius-card`, `--shadow-card`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TriageDetailModal } from "./TriageDetailModal";
import type { TriageItem } from "../../lib/triageApi";

vi.mock("../../hooks/useTriage", () => ({
  useDismissTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSnoozeTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePromoteTriageItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const item: TriageItem = {
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

describe("TriageDetailModal styling", () => {
  it("dialog surface matches the Project Creation wizard tokens", () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TriageDetailModal
          open={true}
          onOpenChange={vi.fn()}
          projectId="proj-a"
          item={item}
        />
      </Wrapper>,
    );
    const content = screen.getByTestId("triage-detail-modal");
    expect(content).toHaveClass("bg-[var(--color-surface)]");
    expect(content).toHaveClass("rounded-[var(--radius-card)]");
    expect(content).toHaveClass("shadow-[var(--shadow-card)]");
  });
});
