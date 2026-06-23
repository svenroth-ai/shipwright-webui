/*
 * TaskBoardColumns — DragOverlay drop-animation regression guard.
 * iterate-2026-06-23-board-drop-animation.
 *
 * dnd-kit's DEFAULT `DragOverlay` drop animation returns the dragged clone to
 * the position of the SOURCE draggable node on release. A board move relocates
 * the card to the target column (optimistic `useSetBoardColumn` update) at the
 * same instant, so the default animates the clone "flipping back to the origin"
 * while the real card is already at the destination — the reported glitch.
 *
 * Fix: `dropAnimation={null}` — the overlay just vanishes on drop, leaving the
 * already-relocated card in place. This test captures the prop dnd-kit's
 * `DragOverlay` actually receives so the fix can't silently regress. (The
 * visual smoothness itself is requires-manual-visual-judgment; this guards the
 * one deterministic lever that drives it.)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

// vi.hoisted — the mock factory is hoisted above imports, so shared mutable
// capture state must be hoisted too (memory: ADR-115 vi.hoisted pattern).
const cap = vi.hoisted(() => ({ dropAnimation: "UNSET" as unknown }));

vi.mock("@dnd-kit/core", async (orig) => {
  const actual = await orig<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    // Capture the prop, render nothing — DndContext + the droppable grid stay real.
    DragOverlay: (props: { dropAnimation?: unknown }) => {
      cap.dropAnimation = props.dropAnimation;
      return null;
    },
  };
});

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
    createdAt: "2026-06-23T00:00:00Z",
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...over,
  };
}

describe("TaskBoardColumns — DragOverlay drop animation", () => {
  it("disables the return-to-origin drop animation (dropAnimation={null})", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TaskBoardColumns tasks={[t("a", { state: "active" })]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // null = "no drop animation"; undefined would mean the default (buggy) one.
    expect(cap.dropAnimation).toBeNull();
  });
});
