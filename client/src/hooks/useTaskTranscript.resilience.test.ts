/*
 * iterate-2026-07-22-transcript-cursor-single-walk — RESILIENCE of the cursor.
 *
 * Accumulation trades a self-correcting poll for a cheap one: while the client
 * asked for the whole file every second, ANY divergence — a mis-spliced delta,
 * a transcript swapped under the same uuid, a bug in the fold — repaired itself
 * within a second and nobody noticed. These cases pin the properties that buy
 * that robustness back explicitly:
 *
 *   - a periodic whole-file resync, because the server's `rotated` signal only
 *     fires on a SHRINK and cannot see a same-or-larger replacement;
 *   - recovery after a chunk the fold rejects;
 *   - a failed poll leaving the cursor exactly where it was.
 *
 * `getTranscript` is mocked; fake timers drive the sequential-poll cadence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { useTaskTranscript, RESYNC_EVERY_POLLS } from "./useTaskTranscript";
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

describe("useTaskTranscript — resilience of the cursor", () => {
  it("resyncs to fromByte 0 every 60th poll, so a same-size rewrite cannot diverge forever", async () => {
    // Internal review, MEDIUM-1 (verified by probe): the server reports
    // `rotated` only on a SHRINK, so a transcript replaced under the same uuid
    // by a same-or-larger one is appended onto the wrong prefix and the pane
    // disagrees with disk permanently. The old whole-file poll healed that by
    // accident once a second; this heals it on purpose once a minute.
    vi.useFakeTimers();
    let served = 0;
    getTranscriptMock.mockImplementation(async () => {
      const at = served * 2;
      served += 1;
      return {
        status: "ok",
        chunk: chunkAt(served === 1 ? 0 : at, at + 2, "x\n", "fp"),
        task: task("active"),
      };
    });

    renderHook(() => useTaskTranscript("t-resync", { intervalMs: 1000 }), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70_000);
    });

    const asked = getTranscriptMock.mock.calls.map(
      (c) => (c[1] as { fromByte?: number }).fromByte,
    );
    expect(asked.length).toBeGreaterThan(61);
    // Poll 0 is the initial baseline; the next whole-file request is the resync
    // and it must NOT come earlier than the interval (that would throw the win
    // away) nor never (that would leave the pane unrepairable).
    const baselines = asked.map((f, i) => (f === 0 ? i : -1)).filter((i) => i >= 0);
    expect(baselines[0]).toBe(0);
    expect(baselines[1]).toBe(RESYNC_EVERY_POLLS);
    expect(baselines.length).toBeGreaterThanOrEqual(2);
  });

  it("after a REJECTED chunk the next poll asks whole-file AND drops the fingerprint", async () => {
    // The fingerprint-null happens in the poller, outside `accumulate`, so the
    // pure fold test cannot cover it (internal review, LOW-8a).
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 4, "a\nb\n", "fp1"),
      task: task("active"),
    });
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(999, 1003, "junk\n", "fp2"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-reject", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    // The bad chunk was dropped, not spliced in...
    expect(result.current.content).toBe("a\nb\n");
    // ...and the recovery poll is a clean whole-file read with no fingerprint
    // left to trip a rotation check.
    expect(requestArgs(2)).toMatchObject({ fromByte: 0, expectFingerprint: null });
  });

  it("a failed poll leaves the cursor and fingerprint intact, so the next tick repeats it", async () => {
    // Internal review, LOW-8b — verified by reading, now pinned.
    vi.useFakeTimers();
    getTranscriptMock.mockResolvedValueOnce({
      status: "ok",
      chunk: chunkAt(0, 4, "a\nb\n", "fp1"),
      task: task("active"),
    });
    getTranscriptMock.mockRejectedValueOnce(new Error("EBUSY"));
    getTranscriptMock.mockResolvedValue({
      status: "ok",
      chunk: chunkAt(4, 8, "c\nd\n", "fp2"),
      task: task("active"),
    });

    const { result } = renderHook(
      () => useTaskTranscript("t-err", { intervalMs: 1000 }),
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    // The failed tick asked from 4; so does the retry — no byte is skipped and
    // none is fetched twice.
    expect(requestArgs(1)).toMatchObject({ fromByte: 4, expectFingerprint: "fp1" });
    expect(requestArgs(2)).toMatchObject({ fromByte: 4, expectFingerprint: "fp1" });
    expect(result.current.content).toBe("a\nb\nc\nd\n");
  });
});
