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

  it("renders a per-column count", () => {
    renderBoard([t("a", { state: "active" }), t("b", { state: "idle" })]);
    expect(within(screen.getByTestId("column-in-progress")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("column-draft")).getByText("0")).toBeTruthy();
  });

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
