import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getProjectRunsMock = vi.fn();
const getProjectRunMock = vi.fn();
const getGradeTrendMock = vi.fn();
vi.mock("../lib/runDataApi", () => ({
  getProjectRuns: (id: string) => getProjectRunsMock(id),
  getProjectRun: (id: string, runId: string) => getProjectRunMock(id, runId),
  getGradeTrend: (id: string) => getGradeTrendMock(id),
}));

import {
  RUN_DATA_POLL_MS,
  useGradeTrend,
  useProjectRuns,
  useRunDetail,
} from "./useRunData";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useRunData", () => {
  afterEach(() => {
    getProjectRunsMock.mockReset();
    getProjectRunMock.mockReset();
    getGradeTrendMock.mockReset();
  });

  it("polls at 30 s (event log is append-per-run, not live)", () => {
    expect(RUN_DATA_POLL_MS).toBe(30_000);
  });

  it("useProjectRuns fetches + surfaces the bundle for a real projectId", async () => {
    getProjectRunsMock.mockResolvedValue({ status: "ok", runs: [], runCount: 0, gradeTrend: [] });
    const { result } = renderHook(() => useProjectRuns("p1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.status).toBe("ok"));
    expect(getProjectRunsMock).toHaveBeenCalledWith("p1");
  });

  it("useProjectRuns is disabled when projectId is null/undefined", () => {
    renderHook(() => useProjectRuns(undefined), { wrapper: wrapper() });
    expect(getProjectRunsMock).not.toHaveBeenCalled();
  });

  it("useRunDetail surfaces run:null for a miss and threads runId", async () => {
    getProjectRunMock.mockResolvedValue({ status: "ok", run: null });
    const { result } = renderHook(
      () => useRunDetail("p1", "iterate-2026-07-14-nomatch0"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.data?.status).toBe("ok"));
    expect(result.current.data?.run).toBeNull();
    expect(getProjectRunMock).toHaveBeenCalledWith("p1", "iterate-2026-07-14-nomatch0");
  });

  it("useRunDetail is disabled without a runId (task carries none)", () => {
    renderHook(() => useRunDetail("p1", null), { wrapper: wrapper() });
    expect(getProjectRunMock).not.toHaveBeenCalled();
  });

  it("useGradeTrend fetches the series for a real projectId", async () => {
    getGradeTrendMock.mockResolvedValue({ status: "ok", gradeTrend: [] });
    const { result } = renderHook(() => useGradeTrend("p1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.status).toBe("ok"));
    expect(getGradeTrendMock).toHaveBeenCalledWith("p1");
  });
});
