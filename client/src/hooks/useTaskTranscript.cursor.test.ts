/*
 * iterate-2026-07-22-transcript-cursor-single-walk — the POLLER (AC-1).
 *
 * The hook used to send `fromByte: 0` on every 1 Hz tick, so the server re-read,
 * re-decoded and re-serialised the WHOLE transcript once per second for as long
 * as the tab was open (measured on this project's corpus: 9.19 ms / 2 725 KB per
 * poll at the median, 384.68 ms / 136 MB at the 131.5 MB largest).
 *
 * The fold is pinned in `useTaskTranscript.accumulate.test.ts` and the reset
 * paths in `useTaskTranscript.cursor-reset.test.ts`. Here is what only a
 * running poller can show: that the cursor rides on the request and that the
 * accumulated pane matches what a whole-file read would have returned.
 *
 * `getTranscript` is mocked; fake timers drive the sequential-poll cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useTaskTranscript } from "./useTaskTranscript";
import * as externalApi from "../lib/externalApi";
import type { ExternalTask, TranscriptChunk } from "../lib/externalApi";

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

describe("useTaskTranscript — the poll carries the cursor (AC-1)", () => {
  it("the second poll asks from the first response's toByte, not 0", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 4, "a\nb\n", "fp1"),
      task: task("active"),
    });
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(4, 8, "c\nd\n", "fp2"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-cursor", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestArgs(0).fromByte).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // The point of the run: pre-fix this was `fromByte: 0`, once a second.
    expect(requestArgs(1)).toMatchObject({ fromByte: 4, expectFingerprint: "fp1" });
    expect(result.current.content).toBe("a\nb\nc\nd\n");
  });

  it("content across three polls equals the concatenation of every delta", async () => {
    vi.useFakeTimers();
    for (const c of [
      chunkAt(0, 4, "a\nb\n", "f0"),
      chunkAt(4, 8, "c\nd\n", "f1"),
      chunkAt(8, 12, "e\nf\n", "f2"),
    ]) {
      getTranscriptMock.mockResolvedValueOnce({ status: "ok", chunk: c, task: task("active") });
    }
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(12, 12, "", "f2"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-acc", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    // Byte-identical to what one `fromByte: 0` poll would have returned here.
    expect(result.current.content).toBe("a\nb\nc\nd\ne\nf\n");
    expect(result.current.status).toBe("ok");
  });

  it("exposes a model name found in an EARLIER delta, not just the latest", async () => {
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 28, '{"model":"claude-opus-4-8"}\n', "f0"),
      task: task("active"),
    });
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(28, 44, '{"type":"user"}\n', "f1"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-model", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    // Free pre-cursor (every poll carried the whole file); with deltas it
    // only works if the previous value is carried forward.
    expect(result.current.modelName).toBe("claude-opus-4-8");
  });
});
