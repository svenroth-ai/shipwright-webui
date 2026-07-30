/*
 * ws-resync.test.ts — client-requested full-grid resync
 * (iterate-2026-07-30-terminal-ws-drop-resync, AC-3).
 *
 * `deliverWithBackpressure` discards a pty chunk when the WS is saturated and never
 * resends it. Claude repaints DIFFERENTIALLY (CUP + CUF cell-skips, which do not
 * erase), so those repaints land on a holed grid and leave stale characters that
 * never heal. The remedy is to re-apply the whole grid, not to repaint again.
 *
 * The subtle part — and the reason these tests exist rather than just a happy path:
 * a resync that simply serialized and sent would LOSE the bytes it exists to
 * restore. Output produced while the snapshot serializes would reach the client
 * BEFORE the snapshot and then be wiped by the client's `term.reset()`. So the
 * resync must reuse the attach ordering: pause -> buffer live output -> emit
 * snapshot -> flush -> resume. `serves buffered live output AFTER the snapshot`
 * below is that invariant.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

import { buildWsHandlers, isWSInbound } from "./ws-upgrade-handler.js";
import {
  makeCtx,
  makePtyManager,
  makeWs,
  readSent,
  flushAsync,
  type MockPtyManager,
  type MockWs,
} from "./ws-upgrade-handler.fixtures.js";

const SNAP = {
  version: "v2" as const,
  terminalVersion: "6.0.0",
  cols: 80,
  rows: 24,
  data: "GRID",
};

describe("isWSInbound — resync frame", () => {
  it("accepts a dimension-less resync frame", () => {
    expect(isWSInbound({ type: "resync" })).toBe(true);
  });

  it("ignores stray fields rather than rejecting", () => {
    expect(isWSInbound({ type: "resync", cols: 80 })).toBe(true);
  });
});

describe("buildWsHandlers — resync", () => {
  let pty: MockPtyManager;
  let ws: MockWs;
  let handlers: ReturnType<typeof buildWsHandlers>;

  function boot(opts: Parameters<typeof makePtyManager>[0] = {}) {
    pty = makePtyManager({ liveSnapshot: SNAP, ...opts });
    ws = makeWs();
    handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
    handlers.onOpen?.({} as Event, ws as never);
    return flushAsync();
  }

  const sendResync = () =>
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "resync" }) } as never,
      ws as never,
    );

  const snapshots = () =>
    readSent(ws).filter(
      (e) => (e as { type?: string }).type === "replay_snapshot",
    );

  beforeEach(async () => {
    await boot();
    // The ATTACH replay already pauses/resumes and resolves a snapshot once, so
    // clear those counters to measure the resync alone rather than attach + resync.
    ws.send.mockClear();
    pty.__mocks.pauseForConn.mockClear();
    pty.__mocks.resumeForConn.mockClear();
    pty.__mocks.serializeMirrorIfLive.mockClear();
  });

  it("answers with a fresh replay_snapshot", async () => {
    sendResync();
    await flushAsync();
    expect(snapshots()).toHaveLength(1);
    // Envelope carries the parser-resync preamble (CAN + CUP) — see
    // snapshot-parser-resync.test.ts for why the restore needs it.
    const data = (snapshots()[0] as { data: string }).data;
    expect(data.endsWith("GRID")).toBe(true);
    expect(data.startsWith(String.fromCharCode(24))).toBe(true);
  });

  it("pauses and resumes this connection around the snapshot", async () => {
    sendResync();
    await flushAsync();
    expect(pty.__mocks.pauseForConn).toHaveBeenCalledTimes(1);
    expect(pty.__mocks.resumeForConn).toHaveBeenCalledTimes(1);
  });

  it("resolves live-mirror-first (ADR-092)", async () => {
    sendResync();
    await flushAsync();
    expect(pty.__mocks.serializeMirrorIfLive).toHaveBeenCalledWith("task-1");
  });

  /*
   * THE ORDERING INVARIANT. Live output produced while the snapshot serializes must
   * arrive AFTER it. Sent before, the client's term.reset() would erase it and the
   * resync would itself lose bytes — the very defect it repairs.
   */
  it("serves buffered live output AFTER the snapshot, never before", async () => {
    // Take control of when serialization completes.
    let release!: (v: unknown) => void;
    pty.__mocks.serializeMirrorIfLive.mockImplementationOnce(
      () => new Promise((r) => { release = r; }),
    );
    const sub = pty.__mocks.subscribeForConnection.mock.calls[0][2] as {
      onData: (d: string) => void;
    };

    sendResync();
    await flushAsync();
    // Pty emits while the snapshot is still being produced.
    sub.onData("MID-FLIGHT");
    expect(readSent(ws)).toHaveLength(0); // buffered, not sent

    release(SNAP);
    await flushAsync();

    const types = readSent(ws).map((e) => (e as { type: string }).type);
    const payloads = readSent(ws).map((e) => (e as { payload?: string }).payload);
    expect(types).toEqual(["replay_snapshot", "data"]);
    expect(payloads[1]).toBe("MID-FLIGHT");
  });

  it("resumes the pty and reopens the gate when the resolver throws", async () => {
    pty.__mocks.serializeMirrorIfLive.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      sendResync();
      await flushAsync();
      expect(pty.__mocks.resumeForConn).toHaveBeenCalledTimes(1);
      // Live output must flow again rather than stay buffered forever.
      const sub = pty.__mocks.subscribeForConnection.mock.calls[0][2] as {
        onData: (d: string) => void;
      };
      sub.onData("AFTER");
      expect(
        readSent(ws).some((e) => (e as { payload?: string }).payload === "AFTER"),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("emits no snapshot when neither live mirror nor disk has one", async () => {
    pty.__mocks.serializeMirrorIfLive.mockResolvedValueOnce(null);
    sendResync();
    await flushAsync();
    expect(snapshots()).toHaveLength(0);
    // Still must not strand the pty paused or the gate closed.
    expect(pty.__mocks.resumeForConn).toHaveBeenCalledTimes(1);
  });

  /*
   * Sending 25 frames synchronously does NOT exercise `resyncGate`: the first call
   * sets `replayBusy` before its first await, so the rest return at that check and
   * never reach `tryAcquire` — the throttle could be deleted and such a test would
   * stay green (external review: vacuous test). The gate's load-bearing half is the
   * INTERVAL FLOOR, so each request must be allowed to COMPLETE before the next.
   */
  it("throttles back-to-back completed resyncs to the interval floor", async () => {
    sendResync();
    await flushAsync();
    expect(snapshots()).toHaveLength(1);

    // Second request after the first has fully settled — `replayBusy` is clear, so
    // this reaches the gate, which refuses it inside the 1 s floor.
    sendResync();
    await flushAsync();
    expect(
      snapshots(),
      "the interval floor is the only DoS bound on a reader-reachable, mirror-serializing path",
    ).toHaveLength(1);
    expect(pty.__mocks.serializeMirrorIfLive).toHaveBeenCalledTimes(1);
  });

  it("still coalesces a synchronous burst (replayBusy short-circuit)", async () => {
    for (let i = 0; i < 25; i++) sendResync();
    await flushAsync();
    expect(snapshots()).toHaveLength(1);
  });

  /*
   * A reader's grid is holed by a dropped chunk exactly like a writer's, and resync
   * pokes no pty — so it must NOT be writer-gated. Gating it would leave every
   * read-only tab permanently smeared.
   */
  it("serves a READER rather than answering read_only", async () => {
    pty = makePtyManager({
      liveSnapshot: SNAP,
      attachResult: { role: "reader", hadPriorWriter: true },
    });
    ws = makeWs();
    handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();
    ws.send.mockClear();

    sendResync();
    await flushAsync();

    const types = readSent(ws).map((e) => (e as { type: string }).type);
    expect(types).toContain("replay_snapshot");
    expect(types).not.toContain("read_only");
  });

  it("keeps redraw and resize writer-gated (no regression)", async () => {
    pty = makePtyManager({
      liveSnapshot: SNAP,
      attachResult: { role: "reader", hadPriorWriter: true },
    });
    ws = makeWs();
    handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();
    ws.send.mockClear();

    handlers.onMessage?.(
      { data: JSON.stringify({ type: "redraw" }) } as never,
      ws as never,
    );
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "resize", cols: 10, rows: 5 }) } as never,
      ws as never,
    );
    expect(pty.__mocks.forceRedraw).not.toHaveBeenCalled();
    expect(pty.__mocks.resize).not.toHaveBeenCalled();
    expect(
      readSent(ws).filter((e) => (e as { type: string }).type === "read_only"),
    ).toHaveLength(2);
  });
});
