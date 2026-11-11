/*
 * TriageItemCard.layout.test.tsx - card layout guards (iterate-2026-11-11-triage-card-dialog-polish):
 * equal-height fill, wrapping inside the card, one-column findings list, and the
 * edit chip without the word "Suggested". Split from TriageItemCard.test.tsx
 * to stay under the 300-line cap.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { TriageItemCard } from "./TriageItemCard";
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
describe("TriageItemCard layout", () => {
  it("fills its grid cell (equal-height cards) and wraps long unbroken text inside itself", () => {
    mount();
    const card = screen.getByTestId(`triage-item-${item.id}`);
    expect(card).toHaveClass("h-full");
    expect(screen.getByTestId(`triage-item-${item.id}-title`).parentElement?.className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  it("findings sit in one minmax(0,1fr) column so a long check title cannot widen the card, and extra checks collapse to +N more", () => {
    mount({
      detail: [
        "Compliance: 4 open finding(s)",
        "- B/B7: Every commit since release tag has a matching event",
        "- G/G2: Conventional-commit scope matches alias-map / split / stop-words and then some more words",
        "- H/H1: Bloat drift",
        "- C/C1: Design manifest",
      ].join(String.fromCharCode(10)),
    });
    const list = screen.getByTestId(`triage-item-${item.id}-findings`);
    expect(list.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(list.querySelectorAll("li")).toHaveLength(4); // 3 checks + the "+1 more" line
    expect(screen.getByTestId(`triage-item-${item.id}-findings-more`)).toHaveTextContent("+1 more");
  });

  it("never uses the --body / --muted tokens inside the card (.on-photo flips them to near-white there)", () => {
    mount({ detail: "Compliance: 1 open finding(s)" + String.fromCharCode(10) + "- B/B7: Orphan FR" });
    const html = screen.getByTestId(`triage-item-${item.id}`).outerHTML;
    expect(html).not.toContain("var(--body");
    expect(html).not.toContain("var(--muted");
  });

  it("the edit chip shows priority and domain without the word 'Suggested'", () => {
    mount();
    const chip = screen.getByTestId(`triage-quick-edit-trigger-${item.id}`);
    expect(chip.textContent ?? "").not.toMatch(/suggested/i);
    expect(chip.textContent ?? "").toContain(item.suggestedPriority);
  });
});
