import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import type { DesignGate } from "../lib/designReviewApi";
import type { ExternalTask, ExternalTaskState } from "../lib/externalApi";

const designGateMock = vi.fn<() => { data: DesignGate | undefined }>();
vi.mock("./useDesignGate", () => ({
  useDesignGate: () => designGateMock(),
}));

import { missionStateFrom, useMissionState } from "./useMissionState";

function task(overrides: Partial<ExternalTask> & { state: ExternalTaskState }): ExternalTask {
  return {
    taskId: "t1",
    sessionUuid: "s1",
    cwd: "/tmp",
    pluginDirs: [],
    title: "T",
    projectId: "p1",
    createdAt: new Date().toISOString(),
    inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
    ...overrides,
  };
}

function gate(active: boolean): { data: DesignGate } {
  return { data: { active, phaseTaskId: null, phase: null } };
}

afterEach(() => designGateMock.mockReset());

describe("missionStateFrom — the pure truth table", () => {
  it("designgate WINS over an active session", () => {
    expect(missionStateFrom({ taskState: "active", designGateActive: true })).toBe("designgate");
  });
  it("an active (in_progress) session → live", () => {
    expect(missionStateFrom({ taskState: "active", designGateActive: false })).toBe("live");
  });
  it("done / idle / draft → done", () => {
    expect(missionStateFrom({ taskState: "done", designGateActive: false })).toBe("done");
    expect(missionStateFrom({ taskState: "idle", designGateActive: false })).toBe("done");
    expect(missionStateFrom({ taskState: "draft", designGateActive: false })).toBe("done");
  });
});

describe("useMissionState", () => {
  it("designgate wins over a live session", () => {
    designGateMock.mockReturnValue(gate(true));
    const { result } = renderHook(() => useMissionState(task({ state: "active" })));
    expect(result.current).toBe("designgate");
  });

  it("an active session with no gate → live", () => {
    designGateMock.mockReturnValue(gate(false));
    const { result } = renderHook(() => useMissionState(task({ state: "active" })));
    expect(result.current).toBe("live");
  });

  it("the liveSession trap: a done task with a live PTY does NOT read as live", () => {
    designGateMock.mockReturnValue(gate(false));
    // liveSession=true is PTY existence, not "Claude is working"; it must be ignored.
    const { result } = renderHook(() =>
      useMissionState(task({ state: "done", liveSession: true })),
    );
    expect(result.current).toBe("done");
  });

  it("no task → done", () => {
    designGateMock.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useMissionState(null));
    expect(result.current).toBe("done");
  });
});
