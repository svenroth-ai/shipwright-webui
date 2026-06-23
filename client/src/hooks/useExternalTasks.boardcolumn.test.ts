/*
 * useSetBoardColumn — race-safe optimistic board-column mutation.
 * iterate-2026-06-17-board-dnd-status-decouple. Covers the external plan
 * review's HIGH finding: the ~2 s list poll can land mid-mutation, so the
 * hook must cancel in-flight list fetches, optimistically flip in place,
 * and roll back on error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useSetBoardColumn } from "./useExternalTasks";
import type { ExternalTask } from "../lib/externalApi";
import * as boardColumnApi from "../lib/boardColumnApi";
import { reopenTask } from "../lib/taskReopenApi";

vi.mock("../lib/boardColumnApi", async (orig) => {
  const actual = await orig<typeof import("../lib/boardColumnApi")>();
  return { ...actual, setBoardColumn: vi.fn() };
});
vi.mock("../lib/taskReopenApi", () => ({ reopenTask: vi.fn() }));
const mockedSet = vi.mocked(boardColumnApi.setBoardColumn);
const mockedReopen = vi.mocked(reopenTask);

/** A terminal `done` card seeded into a list cache. */
function done(id: string): ExternalTask {
  return { taskId: id, state: "done", title: id, boardColumn: "done" } as unknown as ExternalTask;
}

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

function t(id: string, boardColumn?: string): ExternalTask {
  return { taskId: id, state: "active", title: id, boardColumn } as unknown as ExternalTask;
}

const LIST_NULL = ["external-tasks", null] as const;

describe("useSetBoardColumn", () => {
  it("applies the optimistic boardColumn immediately while the request is in-flight", async () => {
    qc.setQueryData(LIST_NULL, [t("t1"), t("t2")]);
    let resolveFn!: (task: ExternalTask) => void;
    mockedSet.mockReturnValue(new Promise<ExternalTask>((r) => { resolveFn = r; }));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    act(() => result.current.mutate({ taskId: "t1", column: "done" }));

    // Optimistic flip lands before the server resolves (no snap-back window).
    await waitFor(() => {
      const list = qc.getQueryData<ExternalTask[]>(LIST_NULL)!;
      expect(list.find((x) => x.taskId === "t1")!.boardColumn).toBe("done");
      expect(list.find((x) => x.taskId === "t2")!.boardColumn).toBeUndefined();
    });

    act(() => resolveFn(t("t1", "done")));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("cancels in-flight list queries before mutating (poll-race guard, HIGH)", async () => {
    qc.setQueryData(LIST_NULL, [t("t1")]);
    const cancelSpy = vi.spyOn(qc, "cancelQueries");
    mockedSet.mockResolvedValue(t("t1", "done"));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ taskId: "t1", column: "done" });
    });

    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ["external-tasks"] });
  });

  it("rolls back the optimistic update on error", async () => {
    qc.setQueryData(LIST_NULL, [t("t1", "backlog")]);
    mockedSet.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    act(() => result.current.mutate({ taskId: "t1", column: "done" }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const list = qc.getQueryData<ExternalTask[]>(LIST_NULL)!;
    expect(list[0].boardColumn).toBe("backlog"); // restored to snapshot
  });

  it("reopen:true routes to reopenTask(taskId, column) — not setBoardColumn (drag/menu out of Done)", async () => {
    qc.setQueryData(LIST_NULL, [done("d")]);
    mockedReopen.mockResolvedValue({ ...done("d"), state: "draft", boardColumn: "in_progress" });

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ taskId: "d", column: "in_progress", reopen: true });
    });

    expect(mockedReopen).toHaveBeenCalledWith("d", "in_progress");
    expect(mockedSet).not.toHaveBeenCalled();
  });

  it("reopen optimistically flips state→draft AND boardColumn (no locked-done flash)", async () => {
    qc.setQueryData(LIST_NULL, [done("d")]);
    let resolveFn!: (task: ExternalTask) => void;
    mockedReopen.mockReturnValue(new Promise<ExternalTask>((r) => { resolveFn = r; }));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    act(() => result.current.mutate({ taskId: "d", column: "in_progress", reopen: true }));

    await waitFor(() => {
      const card = qc.getQueryData<ExternalTask[]>(LIST_NULL)!.find((x) => x.taskId === "d")!;
      expect(card.boardColumn).toBe("in_progress");
      expect(card.state).toBe("draft"); // unlocked: isDone=false → Resume/Launch CTA renders
    });

    act(() => resolveFn({ ...done("d"), state: "draft", boardColumn: "in_progress" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("reopen falsy keeps the pure setBoardColumn path (rule 23 — live task pure column move)", async () => {
    qc.setQueryData(LIST_NULL, [t("a")]);
    mockedSet.mockResolvedValue(t("a", "done"));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ taskId: "a", column: "done" });
    });

    expect(mockedSet).toHaveBeenCalledWith("a", "done");
    expect(mockedReopen).not.toHaveBeenCalled();
  });

  it("flips the card across every project-filtered list cache", async () => {
    qc.setQueryData(LIST_NULL, [t("t1"), t("t2")]);
    qc.setQueryData(["external-tasks", "p1"], [t("t1")]);
    mockedSet.mockResolvedValue(t("t1", "in_progress"));

    const { result } = renderHook(() => useSetBoardColumn(), { wrapper });
    act(() => result.current.mutate({ taskId: "t1", column: "in_progress" }));

    await waitFor(() => {
      expect(
        qc.getQueryData<ExternalTask[]>(LIST_NULL)!.find((x) => x.taskId === "t1")!
          .boardColumn,
      ).toBe("in_progress");
      expect(
        qc.getQueryData<ExternalTask[]>(["external-tasks", "p1"])![0].boardColumn,
      ).toBe("in_progress");
    });
  });
});
