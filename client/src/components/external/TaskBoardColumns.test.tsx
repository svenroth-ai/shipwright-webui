/*
 * TaskBoardColumns — grouping coverage (AC-3 + AC-5 at the component level).
 * iterate-2026-06-17-board-dnd-status-decouple.
 *
 * The board groups by `boardColumn ?? deriveBoardColumn(state)`: with no
 * override a card lands in its state-derived column (parity with the old
 * groupByState), and an explicit boardColumn override wins — so a live
 * (active) task can be parked in Done. Drag wiring itself is covered by the
 * useSetBoardColumn hook test + the Playwright E2E.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";

import { TaskBoardColumns } from "./TaskBoardColumns";
import type { ExternalTask } from "../../lib/externalApi";

function t(id: string, over: Partial<ExternalTask> = {}): ExternalTask {
  return {
    taskId: id,
    sessionUuid: `uuid-${id}`,
    title: id,
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p",
    state: "draft",
    createdAt: "2026-06-17T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

function renderBoard(tasks: ExternalTask[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskBoardColumns tasks={tasks} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TaskBoardColumns — grouping", () => {
  // @covers FR-01.65
  it("places cards in the state-derived column when there is no override (parity)", () => {
    renderBoard([
      t("d", { state: "draft" }),
      t("a", { state: "active" }),
      t("w", { state: "awaiting_external_start" }),
      t("f", { state: "done" }),
    ]);
    expect(within(screen.getByTestId("column-draft")).getByTestId("task-card-d")).toBeTruthy();
    expect(
      within(screen.getByTestId("column-in-progress")).getByTestId("task-card-a"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("column-in-progress")).getByTestId("task-card-w"),
    ).toBeTruthy();
    expect(within(screen.getByTestId("column-done")).getByTestId("task-card-f")).toBeTruthy();
  });

  // @covers FR-01.65
  it("boardColumn override wins over the state-derived column (AC-5 decoupling)", () => {
    renderBoard([
      t("liveInDone", { state: "active", boardColumn: "done" }),
      t("draftInProg", { state: "draft", boardColumn: "in_progress" }),
      t("doneInBacklog", { state: "done", boardColumn: "backlog" }),
    ]);
    const done = within(screen.getByTestId("column-done"));
    const inProg = within(screen.getByTestId("column-in-progress"));
    expect(done.getByTestId("task-card-liveInDone")).toBeTruthy();
    expect(inProg.getByTestId("task-card-draftInProg")).toBeTruthy();
    expect(
      within(screen.getByTestId("column-draft")).getByTestId("task-card-doneInBacklog"),
    ).toBeTruthy();

    // AC-5 — Status ↔ Resume decoupled: the CTA keys off `state`, not column.
    // A live (active) task parked in Done STILL offers Resume; a never-launched
    // draft pulled into In Progress STILL offers the green Launch.
    expect(done.getByTestId("task-card-resume-liveInDone")).toBeTruthy();
    expect(inProg.getByTestId("task-card-launch-draftInProg")).toBeTruthy();
  });

  // @covers FR-01.65
  it("orders cards within a column newest-modified first (AC-1)", () => {
    // Same column (all active → in-progress), deliberately fed out of order.
    renderBoard([
      t("stale", { state: "active", lastJsonlSeenMtimeMs: 1_000 }),
      t("fresh", { state: "active", lastJsonlSeenMtimeMs: 9_000 }),
      t("mid", { state: "active", lastJsonlSeenMtimeMs: 5_000 }),
    ]);
    const col = screen.getByTestId("column-in-progress");
    const ids = Array.from(
      col.querySelectorAll('[data-testid^="task-card-draggable-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "task-card-draggable-fresh",
      "task-card-draggable-mid",
      "task-card-draggable-stale",
    ]);
  });

  // @covers FR-01.65
  it("breaks equal-timestamp ties deterministically by taskId (AC-4)", () => {
    renderBoard([
      t("zebra", { state: "active", lastJsonlSeenMtimeMs: 1_000 }),
      t("alpha", { state: "active", lastJsonlSeenMtimeMs: 1_000 }),
    ]);
    const col = screen.getByTestId("column-in-progress");
    const ids = Array.from(
      col.querySelectorAll('[data-testid^="task-card-draggable-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "task-card-draggable-alpha",
      "task-card-draggable-zebra",
    ]);
  });

  // @covers FR-01.65
  it("renders a per-column count", () => {
    renderBoard([t("a", { state: "active" }), t("b", { state: "idle" })]);
    expect(within(screen.getByTestId("column-in-progress")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("column-draft")).getByText("0")).toBeTruthy();
  });

  // @covers FR-01.65
  it("renders each column as a per-tone COLORED GLASS panel (dark tint + backdrop blur), not the opaque --g50 (AC1)", () => {
    // Sven feedback 2026-07-17 (mockup Spec/prototype/_shots/board.png): each
    // column PANEL is a translucent glass tinted in ITS OWN column colour
    // (draft=neutral grey, in-progress=amber, done=blue) with a backdrop blur —
    // the shared opaque near-white `--g50` ground is gone. Per-column tint is
    // distinct so the three columns read as their own colour.
    renderBoard([t("a", { state: "active" })]);
    const tintByColumn: Record<string, string> = {
      "column-draft": "var(--g500)",
      "column-in-progress": "var(--color-warning)",
      "column-done": "var(--color-info)",
    };
    for (const [testId, tint] of Object.entries(tintByColumn)) {
      const col = screen.getByTestId(testId) as HTMLElement;
      // Assert on the panel BACKGROUND specifically (not the whole serialized
      // style) — the same tint token also rides the panel border + top accent,
      // so a background-only regression must be caught here (external-review
      // fold, OpenAI). The panel is the dark colored glass = tint over the warm
      // near-black base, and is NOT the old opaque `--g50` ground.
      const bg = col.style.background;
      expect(bg, `${testId} panel background tint`).toContain(tint);
      expect(bg, `${testId} dark glass base`).toContain("rgba(35, 31, 24");
      expect(bg, `${testId} panel is not the old --g50 ground`).not.toContain(
        "var(--g50)",
      );
      // glass: a backdrop blur. jsdom exposes backdrop-filter on the style
      // PROPERTY, not the serialized `style` attribute string.
      expect(col.style.backdropFilter, `${testId} backdrop-filter`).toContain(
        "blur",
      );
    }
  });

  // @covers FR-01.65
  it("keeps the per-column 3px top accent (draft=muted, in-progress=warning, done=info) (AC1)", () => {
    // Column identity: the 3px top-accent bar colours are UNCHANGED by the glass
    // restyle (the hue never re-hues — mockup blue/green stays a follow-up).
    renderBoard([t("a", { state: "active" })]);
    const accentByColumn: Record<string, string> = {
      "column-draft": "var(--color-muted)",
      "column-in-progress": "var(--color-warning)",
      "column-done": "var(--color-info)",
    };
    for (const [testId, accent] of Object.entries(accentByColumn)) {
      const col = screen.getByTestId(testId);
      const bar = col.querySelector(':scope > [aria-hidden="true"]');
      expect(bar, `${testId} top accent`).toBeTruthy();
      expect(bar!.getAttribute("style") ?? "").toContain(accent);
    }
  });

  // @covers FR-01.65
  it("renders WHITE column headers, legible on the dark colored glass (AC3)", () => {
    // The dark glass forces the lane header LIGHT (white on dark tint over the
    // photo is comfortably AA; a dark header on the same glass is AA-impossible
    // over the deck photo's dark mast/sail — see the iterate ADR calibration).
    renderBoard([t("a", { state: "active" })]);
    for (const title of ["Backlog", "In Progress", "Done"]) {
      const header = screen.getByText(title).parentElement as HTMLElement;
      expect(
        header.getAttribute("style") ?? "",
        `${title} header colour`,
      ).toContain("rgba(255, 255, 255");
    }
  });

  // @covers FR-01.65
  it("leaves the task cards WHITE — the draggable wrapper adds no background (AC2)", () => {
    // This iterate touches ONLY the column PANEL ground; DraggableCard/TaskCard
    // backgrounds are untouched (the cards stay `var(--card)` white and pop on
    // the dark glass).
    renderBoard([t("a", { state: "active" })]);
    const wrapper = screen.getByTestId("task-card-draggable-a");
    expect(wrapper.getAttribute("style") ?? "").not.toContain("background");
  });

  // @covers FR-01.65
  it("exposes a keyboard-focusable draggable with a11y semantics (AC-7 affordance)", () => {
    // @dnd-kit's useDraggable attributes make the card keyboard-reachable +
    // announce it to screen readers. This is the deterministic evidence that
    // the keyboard DnD path is wired (the KeyboardSensor handles the moves).
    renderBoard([t("k", { state: "active" })]);
    const handle = screen.getByTestId("task-card-draggable-k");
    expect(handle.getAttribute("role")).toBe("button");
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-roledescription")).toBe("draggable");
  });
});
