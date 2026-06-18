import { describe, it, expect, vi, afterEach } from "vitest";

import {
  deriveBoardColumn,
  resolveBoardColumn,
  setBoardColumn,
} from "./boardColumnApi";
import type { ExternalTask, ExternalTaskState } from "./externalApi";

describe("deriveBoardColumn — parity with the historical groupByState", () => {
  it.each([
    ["draft", "backlog"],
    ["done", "done"],
    ["active", "in_progress"],
    ["idle", "in_progress"],
    ["awaiting_external_start", "in_progress"],
    ["jsonl_missing", "in_progress"],
    ["launch_failed", "in_progress"],
  ] as const)("%s → %s", (state, col) => {
    expect(deriveBoardColumn(state as ExternalTaskState)).toBe(col);
  });
});

describe("resolveBoardColumn — override wins, else fallback", () => {
  it("uses boardColumn when set (even if it disagrees with state)", () => {
    expect(resolveBoardColumn({ state: "active", boardColumn: "done" })).toBe("done");
    expect(resolveBoardColumn({ state: "draft", boardColumn: "in_progress" })).toBe(
      "in_progress",
    );
  });
  it("falls back to derive when boardColumn is absent", () => {
    expect(resolveBoardColumn({ state: "active" })).toBe("in_progress");
    expect(resolveBoardColumn({ state: "draft" })).toBe("backlog");
    expect(resolveBoardColumn({ state: "done" })).toBe("done");
  });
});

describe("setBoardColumn — POSTs /column", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the column and returns the task", async () => {
    const task = { taskId: "t1", boardColumn: "done" } as unknown as ExternalTask;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await setBoardColumn("t1", "done");
    expect(out).toEqual(task);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/external/tasks/t1/column",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ column: "done" });
  });
});
