/*
 * TriageItemRow.test.tsx — the Triage row (iterate-2026-11-12-triage-lanes-rows;
 * successor of the card tests): severity + copyable id before the title, the
 * actions it carries (primary CTA, Promote, Snooze, Dismiss, pencil), the
 * Fix-now task box and the read-only parked line.
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

function mount(over: Partial<TriageItem> = {}, handlers: Partial<Record<"onOpen" | "onFixNow" | "onNavigateToBoard", () => void>> = {}) {
  const props = {
    projectId: "proj-a",
    item: { ...item, ...over },
    onOpen: vi.fn(),
    onFixNow: vi.fn(),
    onNavigateToBoard: vi.fn(),
    ...handlers,
  };
  render(<ul><TriageItemRow {...props} /></ul>, { wrapper: wrap });
  return props;
}

// @covers FR-01.30
describe("TriageItemRow — layout (iterate-2026-11-12-triage-lanes-rows)", () => {
  it("puts the title first, then a ROUND numbered severity right before the id, and wraps long titles inside the row", () => {
    mount();
    const sev = screen.getByTestId("triage-severity-medium");
    const id = screen.getByTestId(`triage-item-${item.id}-id`);
    const title = screen.getByTestId(`triage-item-${item.id}-title`);
    expect(title.compareDocumentPosition(sev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sev.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.parentElement?.className).toContain("[overflow-wrap:anywhere]");
    // medium = 3, shown as a number in a circle; the word is the tooltip / accessible name
    expect(sev.textContent).toBe("3");
    expect(sev.className).toContain("rounded-full");
    expect(sev.getAttribute("aria-label")).toBe("Severity: Medium");
  });

  it("maps every severity to its number (critical 1 … info 5)", () => {
    for (const [sev, n] of [["critical", "1"], ["high", "2"], ["low", "4"], ["info", "5"]] as const) {
      const { unmount } = render(<ul><TriageItemRow projectId="proj-a" item={{ ...item, severity: sev }} onOpen={vi.fn()} onFixNow={vi.fn()} onNavigateToBoard={vi.fn()} /></ul>, { wrapper: wrap });
      expect(screen.getByTestId(`triage-severity-${sev}`).textContent).toBe(n);
      unmount();
    }
  });

  it("shows no priority/domain pill, no coloured severity dot and no detail text on the row", () => {
    mount();
    const row = screen.getByTestId(`triage-item-${item.id}`);
    expect(row).not.toHaveTextContent("engineering");
    expect(row).not.toHaveTextContent(item.detail);
  });

  it("never uses the --body / --muted tokens inside the row (.on-photo flips them to near-white there)", () => {
    mount();
    const html = screen.getByTestId(`triage-item-${item.id}`).outerHTML;
    expect(html).not.toContain("var(--body");
    expect(html).not.toContain("var(--muted");
  });

  it("the pencil is an icon button beside the other actions, not a chip", () => {
    mount();
    const pencil = screen.getByTestId(`triage-quick-edit-trigger-${item.id}`);
    expect(pencil.textContent ?? "").toBe("");
    expect(screen.getByTestId(`triage-row-actions-${item.id}`)).toContainElement(pencil);
  });
});

// @covers FR-01.30
describe("TriageItemRow — copyable id", () => {
  it("the id is one-click selectable text (select-all) and clicking it does not open the detail", () => {
    const p = mount();
    const id = screen.getByTestId(`triage-item-${item.id}-id`);
    expect(id).toHaveTextContent(item.id);
    expect(id.className).toContain("select-all");
    fireEvent.click(id);
    fireEvent.doubleClick(id);
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it("the copy button writes exactly the id to the clipboard and does not open the detail", async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const p = mount();
    fireEvent.click(screen.getByTestId(`triage-item-${item.id}-copy`));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(item.id));
    expect(await screen.findByRole("button", { name: `Copied ${item.id}` })).toBeInTheDocument();
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it("a refused clipboard falls back to selecting the id so Ctrl+C works", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
      configurable: true,
    });
    mount();
    fireEvent.click(screen.getByTestId(`triage-item-${item.id}-copy`));
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(item.id));
    expect(screen.getByRole("button", { name: `Copy ${item.id}` })).toBeInTheDocument();
  });
});

// @covers FR-01.30
describe("TriageItemRow — Returned badge (AC8, iterate-2026-08-08-triage-filters-sort-parked)", () => {
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
describe("TriageItemRow — actions (iterate-2026-11-08-triage-page-redesign)", () => {
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

  it("Dismiss asks for a reason first and flips the item only after confirming", async () => {
    dismissMutate.mockClear();
    mount();
    fireEvent.click(screen.getByTestId(`triage-card-dismiss-${item.id}`));
    expect(dismissMutate).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByTestId(`triage-dismiss-reason-${item.id}`), {
      target: { value: "  out of scope " },
    });
    fireEvent.click(screen.getByTestId(`triage-dismiss-confirm-${item.id}`));
    await waitFor(() =>
      expect(dismissMutate).toHaveBeenCalledWith({ triageId: item.id, reason: "out of scope" }),
    );
  });

  it("Dismiss without typing a reason sends null", async () => {
    dismissMutate.mockClear();
    mount();
    fireEvent.click(screen.getByTestId(`triage-card-dismiss-${item.id}`));
    fireEvent.click(await screen.findByTestId(`triage-dismiss-confirm-${item.id}`));
    await waitFor(() => expect(dismissMutate).toHaveBeenCalledWith({ triageId: item.id, reason: null }));
  });

  it("Cancel in the Dismiss popup dismisses nothing", async () => {
    dismissMutate.mockClear();
    mount();
    fireEvent.click(screen.getByTestId(`triage-card-dismiss-${item.id}`));
    fireEvent.click(await screen.findByTestId(`triage-dismiss-cancel-${item.id}`));
    expect(dismissMutate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId(`triage-dismiss-popover-${item.id}`)).toBeNull());
  });

  it("a rejected Dismiss keeps the popup open and shows the error", async () => {
    dismissMutate.mockResolvedValueOnce({ ok: false, status: 409, body: { message: "Already handled" } } as never);
    mount();
    fireEvent.click(screen.getByTestId(`triage-card-dismiss-${item.id}`));
    fireEvent.click(await screen.findByTestId(`triage-dismiss-confirm-${item.id}`));
    expect((await screen.findByTestId(`triage-card-error-${item.id}`)).textContent).toContain("Already handled");
    expect(screen.getByTestId(`triage-dismiss-popover-${item.id}`)).toBeInTheDocument();
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

  it("shows the project label only when given", () => {
    const props = {
      projectId: "proj-a",
      item,
      projectLabel: "alpha",
      onOpen: vi.fn(),
      onFixNow: vi.fn(),
      onNavigateToBoard: vi.fn(),
    };
    render(<ul><TriageItemRow {...props} /></ul>, { wrapper: wrap });
    expect(screen.getByTestId(`triage-item-${item.id}-project`)).toHaveTextContent("alpha");
  });

  it("a parked item is read-only and says when it returns", () => {
    mount({ status: "snoozed", revisitAt: "2026-12-01" });
    expect(screen.queryByTestId(`triage-card-fix-now-${item.id}`)).toBeNull();
    expect(screen.getByTestId(`triage-deferred-item-${item.id}-revisit`)).toHaveTextContent("returns on 2026-12-01");
  });
});
