/*
 * iterate-2026-07-22-transcript-cursor-single-walk — the RESETS (AC-2, AC-3).
 *
 * Accumulation is only safe if every path that invalidates the cursor rewinds
 * it: a rotated file, a vanished file, and a switch to another task. Each of
 * those leaves an offset that addresses nothing, so the buffer, the cursor and
 * the fingerprint have to move together — and a late response from the task
 * the user just left must not land in the new one.
 *
 * `getTranscript` is mocked; fake timers drive the sequential-poll cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useTaskTranscript } from "./useTaskTranscript";
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

function chunkAt(
  fromByte: number,
  toByte: number,
  content: string,
  fingerprint = "fp",
): TranscriptChunk {
  return { fingerprint, size: toByte, fromByte, toByte, content };
}

/** What the hook actually ASKED FOR on call `n` — the assertion that matters. */
function requestArgs(n: number): { fromByte?: number; expectFingerprint?: string | null } {
  return getTranscriptMock.mock.calls[n][1] as {
    fromByte?: number;
    expectFingerprint?: string | null;
  };
}

describe("useTaskTranscript — accumulation self-corrects (AC-2)", () => {
  it("rotated clears the buffer AND the cursor, so the next poll refetches whole", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 4, "a\nb\n", "fp1"),
      task: task("active"),
    });
    getTranscriptMock.mockResolvedValueOnce({
      status: "rotated",
      task: task("active"),
      currentFingerprint: "fp-new",
    });
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(0, 2, "z\n", "fp-new"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-rot", { intervalMs: 1000 }),
      { wrapper },
    );
    // t=0 (ok), t=1000 (rotated), t=2000 (ok from 0).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    // An offset into the old file addresses nothing in the new one, so the
    // cursor travels with the fingerprint the rotated branch already nulled.
    expect(requestArgs(2)).toMatchObject({ fromByte: 0, expectFingerprint: null });
    // Replaced, not appended onto the pre-rotation text.
    expect(result.current.content).toBe("z\n");
  });

  it("missing clears the buffer, the model and the cursor", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 28, '{"model":"claude-opus-4-8"}\n', "fp1"),
      task: task("active"),
    });
    getTranscriptMock.mockResolvedValue({ status: "missing", task: task("active") });

    const { result } = renderHook(
      () => useTaskTranscript("t-miss", { intervalMs: 1000 }),
      { wrapper },
    );
    // t=0 (ok), t=1000 (missing), t=2000 (the poll that proves the rewind).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(result.current.status).toBe("missing");
    expect(result.current.content).toBe("");
    expect(result.current.modelName).toBeNull();
    expect(requestArgs(2).fromByte).toBe(0);
  });

  it("a switched taskId starts a fresh buffer at fromByte 0 with no inherited fingerprint", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(0, 4, "a\nb\n", "fp-A"),
      task: task("active", "t-a"),
    });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useTaskTranscript(id, { intervalMs: 1000 }),
      { wrapper, initialProps: { id: "t-a" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.content).toBe("a\nb\n");

    getTranscriptMock.mockReset();
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(0, 2, "B\n", "fp-B"),
      task: task("active", "t-b"),
    });
    rerender({ id: "t-b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Neither A's cursor nor A's fingerprint. The fingerprint carry-over is a
    // pre-existing defect fixed here: sending A's `mtime:size` made the server
    // report a spurious `rotated` whenever B's transcript was the smaller.
    expect(requestArgs(0)).toMatchObject({ fromByte: 0, expectFingerprint: null });
    expect(result.current.content).toBe("B\n");
  });

  it("switching tasks blanks the pane IMMEDIATELY, before the new task's first response", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 28, '{"model":"claude-opus-4-8"}\n', "fp-A"),
      task: task("active", "t-a"),
    });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useTaskTranscript(id, { intervalMs: 1000 }),
      { wrapper, initialProps: { id: "t-a" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.modelName).toBe("claude-opus-4-8");

    // Task B's first poll never settles. The pane must not keep showing A.
    getTranscriptMock.mockImplementation(
      () => new Promise<TranscriptResponse>(() => {}),
    );
    rerender({ id: "t-b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.content).toBe("");
    expect(result.current.modelName).toBeNull();
    expect(result.current.status).toBe("polling");
  });

  it("an in-flight response from the PREVIOUS task never lands in the new buffer", async () => {
    vi.useFakeTimers();
    // Task A's first poll never settles before the switch.
    let settleA: (v: TranscriptResponse) => void = () => {};
    getTranscriptMock.mockImplementationOnce(
      () =>
        new Promise<TranscriptResponse>((res) => {
          settleA = res;
        }),
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useTaskTranscript(id, { intervalMs: 1000 }),
      { wrapper, initialProps: { id: "t-a" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(0, 2, "B\n", "fp-B"),
      task: task("active", "t-b"),
    });
    rerender({ id: "t-b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.content).toBe("B\n");

    // A's response arrives LATE, after B is established.
    await act(async () => {
      settleA({
        status: "ok",
        chunk: chunkAt(0, 6, "AAAA\n", "fp-A"),
        task: task("active", "t-a"),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    // The stale task's bytes must neither replace nor append to B's pane.
    expect(result.current.content).toBe("B\n");
  });
});
