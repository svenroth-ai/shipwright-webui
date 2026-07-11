/*
 * useTaskTranscript — poller-lifecycle regression tests
 * (campaign webui-deep-audit-2026-07-10 / D15, findings F21 + F22).
 *
 * F21 — the terminal-state stop condition previously read `result.task`
 * from the effect's mount-time closure (always the initial `null`), so it
 * never fired: a `done` / `launch_failed` task kept polling forever. The
 * fix tracks the freshest server-reported state in a ref the tick reads.
 *
 * F22 — TaskDetailHeader mounted a SECOND independent 1 Hz poller solely
 * to regex the model name out of the transcript, doubling full-JSONL disk
 * reads per open tab. The fix makes the single poller expose `modelName`
 * so the header can read it as a prop instead of self-polling.
 *
 * `getTranscript` is mocked; fake timers drive the sequential-poll cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useTaskTranscript, extractModelName } from "./useTaskTranscript";
import * as externalApi from "../lib/externalApi";
import type {
  ExternalTask,
  TranscriptChunk,
  TranscriptResponse,
} from "../lib/externalApi";

vi.mock("../lib/externalApi", async (orig) => {
  const actual = await orig<typeof import("../lib/externalApi")>();
  return { ...actual, getTranscript: vi.fn() };
});
const getTranscriptMock = vi.mocked(externalApi.getTranscript);

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

function task(state: ExternalTask["state"], id = "t-1"): ExternalTask {
  return { taskId: id, state, title: id } as unknown as ExternalTask;
}

function chunk(content: string): TranscriptChunk {
  return { fingerprint: "fp", size: content.length, fromByte: 0, toByte: content.length, content };
}

function okResponse(state: ExternalTask["state"], content = ""): TranscriptResponse {
  return { status: "ok", chunk: chunk(content), task: task(state) };
}

describe("useTaskTranscript — terminal-state stop (F21)", () => {
  it("stops polling once the task reaches a terminal state (done)", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue(okResponse("done"));

    renderHook(() => useTaskTranscript("t-done", { intervalMs: 1000 }), { wrapper });
    // Flush the initial tick (async fetch settle + setState).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1);

    // Advance well past several intervals. A correct poller MUST NOT fetch
    // again — the task is terminal. Pre-fix this kept firing (stale closure).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the task reaches launch_failed", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue(okResponse("launch_failed"));

    renderHook(() => useTaskTranscript("t-failed", { intervalMs: 1000 }), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1);
  });

  it("does not inherit a prior task's terminal state across a taskId switch (external review)", async () => {
    // The terminal-state ref outlives the effect. When the poller moves
    // from a `done` task to a still-running one, the new task must keep
    // polling even if its FIRST tick fails (which would otherwise fall
    // back to the stale `done` and stop). Reproduces the external-review
    // HIGH finding.
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue(okResponse("done"));
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useTaskTranscript(id, { intervalMs: 1000 }),
      { wrapper, initialProps: { id: "t-done" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1); // stopped on done

    // Switch to a running task whose first tick REJECTS (transient error).
    getTranscriptMock.mockReset();
    getTranscriptMock.mockRejectedValueOnce(new Error("EBUSY"));
    getTranscriptMock.mockResolvedValue(okResponse("active"));
    rerender({ id: "t-running" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Despite the failed first tick, polling MUST continue (not inherit
    // the prior `done`). Advancing further yields more fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getTranscriptMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps polling while the task is still active (stop is conditional, not global)", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue(okResponse("active"));

    renderHook(() => useTaskTranscript("t-active", { intervalMs: 1000 }), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getTranscriptMock).toHaveBeenCalledTimes(1);
    // Three more ticks fire while non-terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getTranscriptMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("useTaskTranscript — single-source model name (F22)", () => {
  it("exposes the model name extracted from the latest transcript content", async () => {
    vi.useFakeTimers();
    const content =
      '{"type":"user"}\n{"model":"claude-3-5-sonnet"}\n{"model":"claude-opus-4-8"}\n';
    getTranscriptMock.mockResolvedValue(okResponse("done", content));

    const { result } = renderHook(
      () => useTaskTranscript("t-model", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Last `"model":"..."` wins — the header used to compute this from its
    // own duplicate poller (F22); now it flows from this single instance.
    expect(result.current.modelName).toBe("claude-opus-4-8");
  });

  it("modelName is null when the transcript carries no model field", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue(okResponse("active", '{"type":"user"}\n'));

    const { result } = renderHook(
      () => useTaskTranscript("t-nomodel", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.modelName).toBeNull();
  });
});

describe("extractModelName", () => {
  it("returns the last model value in the content", () => {
    expect(extractModelName('{"model":"a"}\n{"model":"b"}')).toBe("b");
  });
  it("returns null when no model field is present", () => {
    expect(extractModelName("nothing here")).toBeNull();
  });
  it("returns null for empty content", () => {
    expect(extractModelName("")).toBeNull();
  });
});
