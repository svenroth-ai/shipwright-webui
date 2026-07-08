/*
 * AC-3 — Board ↔ List order parity.
 * iterate-2026-07-08-board-sort-last-modified.
 *
 * The whole point of the change is a SINGLE, predictable default order. A unit
 * test on the comparator proves the comparator; this proves both components
 * actually apply it identically in their render pipelines. Same fixture (all
 * `active` → the one In-Progress column), rendered in both surfaces: the board
 * column's card order must equal the List's default row order, id-for-id —
 * including the equal-timestamp tiebreak.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, afterEach } from "vitest";

import { TaskBoardColumns } from "./TaskBoardColumns";
import { TaskList } from "./TaskList";
import type { ExternalTask } from "../../lib/externalApi";

afterEach(cleanup);

function mk(over: Partial<ExternalTask> & { taskId: string }): ExternalTask {
  return {
    sessionUuid: `uuid-${over.taskId}`,
    title: over.taskId,
    cwd: "/tmp/p",
    pluginDirs: [],
    projectId: "p",
    state: "active",
    createdAt: "2026-07-01T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  } as ExternalTask;
}

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

function idsFrom(root: HTMLElement, selectorPrefix: string): string[] {
  return Array.from(root.querySelectorAll(`[data-testid^="${selectorPrefix}"]`)).map(
    (el) => el.getAttribute("data-testid")!.slice(selectorPrefix.length),
  );
}

describe("Board ↔ List default order parity (AC-3)", () => {
  it("the In-Progress column order equals the List default order, id-for-id", () => {
    // Deliberately unordered input, all active (one column), incl. an
    // equal-timestamp tie ("t-a" vs "t-b" both at 4_000).
    const tasks = [
      mk({ taskId: "t-old", lastJsonlSeenMtimeMs: 1_000 }),
      mk({ taskId: "t-b", lastJsonlSeenMtimeMs: 4_000 }),
      mk({ taskId: "t-newest", lastJsonlSeenMtimeMs: 9_000 }),
      mk({ taskId: "t-a", lastJsonlSeenMtimeMs: 4_000 }),
      mk({ taskId: "t-mid", lastJsonlSeenMtimeMs: 6_000 }),
    ];

    const board = render(wrap(<TaskBoardColumns tasks={tasks} />));
    const boardIds = idsFrom(
      board.getByTestId("column-in-progress"),
      "task-card-draggable-",
    );
    cleanup();

    const list = render(wrap(<TaskList tasks={tasks} />));
    const listIds = idsFrom(list.container, "task-list-row-");

    const expected = ["t-newest", "t-mid", "t-a", "t-b", "t-old"];
    expect(boardIds).toEqual(expected);
    expect(listIds).toEqual(expected);
    expect(boardIds).toEqual(listIds);
  });
});
