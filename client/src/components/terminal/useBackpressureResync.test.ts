/*
 * useBackpressureResync.test.ts — the client half of the drop repair
 * (iterate-2026-07-30-terminal-ws-drop-resync, AC-3 + AC-6).
 *
 * What this fences. `deliverWithBackpressure` discards a saturated connection's pty
 * chunk and NEVER resends it; Claude's differential repaints (CUF cell-skips, which
 * do not erase) then leave stale characters on the hole forever. Before this hook the
 * loss was silent end to end — `EmbeddedTerminal`'s `onBackpressure` prop was never
 * even supplied by TaskDetailPage, so the callback was a no-op.
 *
 * The properties that matter: exactly ONE resync per saturation episode, requested on
 * the notice that CLOSES it (the server saying delivery resumed) and never on the
 * opening one; and no request at all when nothing was lost.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  useBackpressureResync,
  RESYNC_DEBOUNCE_MS,
} from "./useBackpressureResync";
import type { BackpressureInfo } from "../../hooks/terminalWsContract";

const notice = (over: Partial<BackpressureInfo> = {}): BackpressureInfo => ({
  droppedBytes: 2048,
  droppedChunks: 1,
  totalDroppedBytes: 2048,
  episode: 1,
  episodeEnded: false,
  ...over,
});

function mount(onBackpressure?: (i: BackpressureInfo) => void) {
  const send = vi.fn();
  const hook = renderHook(() => useBackpressureResync({ send, onBackpressure }));
  return { send, hook };
}

const resyncCalls = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter((c) => (c[0] as { type?: string })?.type === "resync");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useBackpressureResync", () => {
  it("requests a resync on the notice that CLOSES the episode", () => {
    const { send, hook } = mount();
    act(() => hook.result.current.onBackpressure(notice({ episodeEnded: true })));
    // Debounced, so still nothing on the same tick.
    expect(resyncCalls(send)).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    expect(resyncCalls(send)).toHaveLength(1);
    expect(send).toHaveBeenCalledWith({ type: "resync" });
  });

  /*
   * The OPENING notice must NOT trigger one (external review, two reasons):
   *   - the socket is still saturated, so the full-grid answer would be queued onto
   *     the congested socket that just dropped output, and a flapping connection
   *     would settle into a resync loop — which drives rule 29's `redraw` on every
   *     settled replay, i.e. the v0.8.6 banner spam that rule fences;
   *   - the old 400 ms debounce was a GUESS at when the socket drained and raced the
   *     server's 1 s floor, so an episode lasting 400-1000 ms had its post-drain
   *     request silently refused with nothing to retry it — a permanent smear.
   */
  it("does NOT request on the opening notice — the socket is still saturated", () => {
    const { send, hook } = mount();
    act(() => hook.result.current.onBackpressure(notice({ episodeEnded: false })));
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS * 4));
    expect(resyncCalls(send)).toHaveLength(0);
  });

  it("a whole episode — many opening notices, one close — yields ONE resync", () => {
    const { send, hook } = mount();
    act(() => {
      for (let i = 0; i < 20; i++) {
        hook.result.current.onBackpressure(
          notice({ droppedBytes: 1024 * (i + 1), episodeEnded: false }),
        );
      }
      hook.result.current.onBackpressure(notice({ episodeEnded: true }));
    });
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    expect(resyncCalls(send)).toHaveLength(1);
  });

  it("requests again for a LATER episode once the first request has fired", () => {
    const { send, hook } = mount();
    act(() => hook.result.current.onBackpressure(notice({ episodeEnded: true })));
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    act(() =>
      hook.result.current.onBackpressure(notice({ episode: 2, episodeEnded: true })),
    );
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    expect(resyncCalls(send)).toHaveLength(2);
  });

  it("does NOT request a resync when the notice reports no loss", () => {
    const { send, hook } = mount();
    act(() =>
      hook.result.current.onBackpressure(
        notice({ droppedBytes: 0, totalDroppedBytes: 0, droppedChunks: 0 }),
      ),
    );
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS * 4));
    expect(resyncCalls(send)).toHaveLength(0);
  });

  it("still repairs when only the legacy droppedBytes field is present", () => {
    const { send, hook } = mount();
    // An older server omits the additive fields; the notice must still act.
    act(() =>
      hook.result.current.onBackpressure({
        droppedBytes: 512,
        droppedChunks: 0,
        totalDroppedBytes: 0,
        episode: 0,
        episodeEnded: false,
      }),
    );
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    expect(resyncCalls(send)).toHaveLength(1);
  });

  it("does not send after unmount, even with a request pending", () => {
    const { send, hook } = mount();
    act(() => hook.result.current.onBackpressure(notice({ episodeEnded: true })));
    hook.unmount();
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS * 4));
    expect(resyncCalls(send)).toHaveLength(0);
  });

  it("forwards the notice to the caller's own handler", () => {
    const seen: BackpressureInfo[] = [];
    const { hook } = mount((i) => seen.push(i));
    const n = notice({ episodeEnded: true, droppedBytes: 4096, droppedChunks: 3 });
    act(() => hook.result.current.onBackpressure(n));
    expect(seen).toEqual([n]);
  });

  it("requestResync serves the drain-queue overflow path (AC-6)", () => {
    const { send, hook } = mount();
    act(() => hook.result.current.requestResync());
    act(() => void vi.advanceTimersByTime(RESYNC_DEBOUNCE_MS));
    expect(resyncCalls(send)).toHaveLength(1);
  });

});
