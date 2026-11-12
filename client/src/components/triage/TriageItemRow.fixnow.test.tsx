/*
 * TriageItemRow.fixnow.test.tsx — the Fix-now task box of the Triage row
 * (iterate-2026-11-09-triage-fixnow-task). Split out of TriageItemRow.test.tsx
 * to keep both files under the 300-line cap.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { TriageItemRow } from "./TriageItemRow";
import type { TriageItem } from "../../lib/triageApi";

const dismissMutate = vi.fn(async (_a: { triageId: string; reason: string | null }) => ({ ok: true }));
const taskLinks = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock("../../hooks/useTriageTaskLinks", () => ({
  useTriageTaskLinks: () => taskLinks.map,
}));

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
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function mount() {
  render(
    <ul>
      <TriageItemRow
        projectId="proj-a"
        item={item}
        onOpen={vi.fn()}
        onFixNow={vi.fn()}
        onNavigateToBoard={vi.fn()}
      />
    </ul>,
    { wrapper: wrap },
  );
}

// @covers FR-01.30
describe("TriageItemRow — Fix-now task (iterate-2026-11-09-triage-fixnow-task)", () => {
  const linkedTask = { taskId: "task-1", title: "Fix drift", state: "active", projectId: "proj-a" };

  it("shows the In progress box and Resolve instead of Fix now, Promote and Snooze", () => {
    taskLinks.map = new Map([[`proj-a:${item.id}`, linkedTask]]);
    try {
      mount();
      const box = screen.getByTestId(`triage-task-box-${item.id}`);
      expect(box.textContent).toContain("In progress");
      expect(box.textContent).toContain("Fix drift");
      expect(screen.getByTestId(`triage-task-state-${item.id}`).textContent).toBe("active");
      expect(screen.getByTestId(`triage-task-open-${item.id}`).getAttribute("href")).toBe("/tasks/task-1");
      expect(screen.getByTestId(`triage-card-resolve-${item.id}`)).toBeInTheDocument();
      expect(screen.queryByTestId(`triage-card-fix-now-${item.id}`)).toBeNull();
      expect(screen.queryByTestId(`triage-card-promote-${item.id}`)).toBeNull();
      expect(screen.queryByTestId(`triage-snooze-menu-${item.id}`)).toBeNull();
    } finally {
      taskLinks.map = new Map();
    }
  });

  it("Resolve dismisses with the prefilled task reason", async () => {
    dismissMutate.mockClear();
    taskLinks.map = new Map([[`proj-a:${item.id}`, linkedTask]]);
    try {
      mount();
      fireEvent.click(screen.getByTestId(`triage-card-resolve-${item.id}`));
      fireEvent.click(await screen.findByTestId(`triage-dismiss-confirm-${item.id}`));
      await waitFor(() =>
        expect(dismissMutate).toHaveBeenCalledWith({ triageId: item.id, reason: "Resolved via task: Fix drift" }),
      );
    } finally {
      taskLinks.map = new Map();
    }
  });

  it("a link for the same id in another project does not show", () => {
    taskLinks.map = new Map([[`proj-b:${item.id}`, linkedTask]]);
    try {
      mount();
      expect(screen.queryByTestId(`triage-task-box-${item.id}`)).toBeNull();
      expect(screen.getByTestId(`triage-card-fix-now-${item.id}`)).toBeInTheDocument();
    } finally {
      taskLinks.map = new Map();
    }
  });
});
