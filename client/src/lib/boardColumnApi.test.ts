import { describe, it, expect, vi, afterEach } from "vitest";

import {
  deriveBoardColumn,
  moveReopensTask,
  resolveBoardColumn,
  setBoardColumn,
} from "./boardColumnApi";
import type { ExternalTask, ExternalTaskState } from "./externalApi";

const LIVE_STATES = [
  "draft",
  "active",
  "idle",
  "awaiting_external_start",
  "jsonl_missing",
  "launch_failed",
] as const satisfies readonly ExternalTaskState[];

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

describe("moveReopensTask — a Done card dragged out of Done must reopen", () => {
  it("true: done → in_progress / backlog (else it strands locked, no Resume)", () => {
    expect(moveReopensTask("done", "in_progress")).toBe(true);
    expect(moveReopensTask("done", "backlog")).toBe(true);
  });

  it("false: done → done is a same-column no-op", () => {
    expect(moveReopensTask("done", "done")).toBe(false);
  });

  it("false: a live (non-done) task moved anywhere stays a pure column move (rule 23)", () => {
    for (const state of LIVE_STATES) {
      expect(moveReopensTask(state, "done")).toBe(false);
      expect(moveReopensTask(state, "in_progress")).toBe(false);
      expect(moveReopensTask(state, "backlog")).toBe(false);
    }
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
