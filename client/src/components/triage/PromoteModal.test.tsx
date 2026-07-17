import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PromoteModal } from "./PromoteModal";
import type { TriageItem } from "../../lib/triageApi";

const mockMutate = vi.fn();

vi.mock("../../hooks/useTriage", () => ({
  usePromoteTriageItem: () => ({
    mutateAsync: mockMutate,
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

const item: TriageItem = {
  id: "trg-aaaa1111",
  ts: "2026-05-13T08:01:00Z",
  originalTs: "2026-05-13T08:01:00Z",
  source: "phaseQuality",
  severity: "high",
  kind: "bug",
  title: "Phase-Quality C1 missing event",
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

function renderModal(opts?: { onPromoted?: Mock }) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <PromoteModal
        open={true}
        onOpenChange={() => {}}
        projectId="proj-a"
        item={item}
        onPromoted={opts?.onPromoted}
      />
    </Wrapper>,
  );
}

describe("PromoteModal", () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  // @covers FR-01.30
  it("pre-fills priority + domain from item.suggested* fields", () => {
    renderModal();
    const priority = screen.getByTestId("promote-priority") as HTMLSelectElement;
    const domain = screen.getByTestId("promote-domain") as HTMLInputElement;
    expect(priority.value).toBe("P1");
    expect(domain.value).toBe("engineering");
  });

  // @covers FR-01.30
  it("submit: comma-splits + trims + filters empty tags", async () => {
    mockMutate.mockResolvedValue({
      kind: "ok",
      data: {
        task: { taskId: "task-123", promotedFromTriageId: "trg-aaaa1111" },
        triageId: "trg-aaaa1111",
        newStatus: "promoted",
        recovered: false,
      },
    });
    renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByTestId("promote-tags"), "auth, billing,  empty-trims  ,,");
    await user.click(screen.getByTestId("promote-submit"));
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["auth", "billing", "empty-trims"],
        }),
      );
    });
  });

  // @covers FR-01.30
  it("calls onPromoted with the new taskId on success", async () => {
    mockMutate.mockResolvedValue({
      kind: "ok",
      data: {
        task: { taskId: "task-456", promotedFromTriageId: "trg-aaaa1111" },
        triageId: "trg-aaaa1111",
        newStatus: "promoted",
        recovered: false,
      },
    });
    const onPromoted = vi.fn();
    renderModal({ onPromoted });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("promote-submit"));
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledWith("task-456", false);
    });
  });

  // @covers FR-01.30
  it("renders a 'partially completed' message on 207", async () => {
    mockMutate.mockResolvedValue({
      kind: "partial",
      data: {
        error: "promote_partial",
        taskId: "task-456",
        triageId: "trg-aaaa1111",
        code: "triage_file_disappeared",
        message: "Status flip failed",
      },
    });
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("promote-submit"));
    expect(await screen.findByTestId("promote-error")).toHaveTextContent(
      /Promote partially completed/i,
    );
  });

  // @covers FR-01.30
  it("shows error toast on 409 already-promoted", async () => {
    mockMutate.mockResolvedValue({
      kind: "error",
      status: 409,
      body: {
        error: "triage_item_not_in_triage_state",
        message: "Already promoted by another session",
      },
    });
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("promote-submit"));
    expect(await screen.findByTestId("promote-error")).toHaveTextContent(
      /Already promoted by another session/i,
    );
  });

  // @covers FR-01.30
  it("blocks submit when domain is empty after trim", async () => {
    renderModal();
    const user = userEvent.setup();
    const domain = screen.getByTestId("promote-domain") as HTMLInputElement;
    await user.clear(domain);
    await user.type(domain, "   ");
    await user.click(screen.getByTestId("promote-submit"));
    expect(await screen.findByTestId("promote-error")).toHaveTextContent(
      /Domain is required/i,
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // iterate-20260515-triage-card-styling — dialog shell matches the
  // Project Creation wizard (white --color-surface + card radius/shadow).
  // @covers FR-01.30
  it("dialog surface matches the Project Creation wizard tokens", () => {
    renderModal();
    const content = screen.getByTestId("triage-promote-modal");
    expect(content).toHaveClass("bg-[var(--color-surface)]");
    expect(content).toHaveClass("rounded-[var(--radius-card)]");
    expect(content).toHaveClass("shadow-[var(--shadow-card)]");
  });
});
