/*
 * ws-backpressure-envelope.test.ts — the two defects the external code review
 * caught in iterate-2026-07-30-terminal-ws-drop-resync, fenced.
 *
 * DEFECT 1 (AC-2 silently undelivered). The WS bridge forwarded the notice as
 * `({ droppedBytes }) => ws.send({type:"backpressure", droppedBytes})`, stripping
 * every cumulative field on the way out. The whole point of AC-2 is that a loss
 * becomes COUNTABLE end to end, and it did not: the client's tolerant parsing
 * turned the missing fields into zeroes, so nothing failed loudly.
 *
 * Why the original tests missed it — worth recording, because the gap was in the
 * test DESIGN, not in the coverage count: the client hook tests call the handler
 * directly with a hand-built notice, and the real-browser spec INJECTS its own
 * synthetic `backpressure` frames. Both sides of the contract were tested; the
 * server's actual emit between them was not. These tests assert on what the socket
 * really receives.
 *
 * DEFECT 2 (the ordering invariant, defeated by its own sibling). `resyncGate`
 * serializes resync against resync but NOT against the attach replay, and both
 * share `liveBuffer`/`replayDone`. Whichever finished first set `replayDone = true`,
 * so live output streamed to the client while the other's snapshot was still
 * resolving — and the client's `term.reset()` then erased it. A resync arriving
 * mid-attach is therefore dropped, which is correct rather than convenient: the
 * attach is already emitting the full grid the resync would have requested.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

import { buildWsHandlers } from "./ws-upgrade-handler.js";
import {
  makeCtx,
  makePtyManager,
  makeWs,
  readSent,
  flushAsync,
  type MockPtyManager,
  type MockWs,
} from "./ws-upgrade-handler.fixtures.js";
import type { BackpressureNotice } from "./backpressure-telemetry.js";

const SNAP = {
  version: "v2" as const,
  terminalVersion: "6.0.0",
  cols: 80,
  rows: 24,
  data: "GRID",
};

/** The subscription object the handler registered with the pty manager. */
function subscription(pty: MockPtyManager) {
  return pty.__mocks.subscribeForConnection.mock.calls[0][2] as {
    onData: (d: string) => void;
    onBackpressure?: (info: BackpressureNotice) => void;
  };
}

describe("backpressure envelope — the whole notice crosses the boundary", () => {
  let pty: MockPtyManager;
  let ws: MockWs;

  beforeEach(async () => {
    pty = makePtyManager({ liveSnapshot: SNAP });
    ws = makeWs();
    buildWsHandlers(makeCtx({ ptyManager: pty })).onOpen?.({} as Event, ws as never);
    await flushAsync();
    ws.send.mockClear();
  });

  const notice = (over: Partial<BackpressureNotice> = {}): BackpressureNotice => ({
    droppedBytes: 4096,
    droppedChunks: 3,
    totalDroppedBytes: 9000,
    episode: 2,
    episodeEnded: false,
    ...over,
  });

  it("forwards every cumulative field on the opening notice", () => {
    subscription(pty).onBackpressure?.(notice());
    const sent = readSent(ws).find(
      (e) => (e as { type?: string }).type === "backpressure",
    );
    expect(sent).toEqual({
      type: "backpressure",
      droppedBytes: 4096,
      droppedChunks: 3,
      totalDroppedBytes: 9000,
      episode: 2,
      episodeEnded: false,
    });
  });

  it("forwards episodeEnded so the client can act on the accurate total", () => {
    subscription(pty).onBackpressure?.(
      notice({ droppedBytes: 12_288, droppedChunks: 7, episodeEnded: true }),
    );
    const sent = readSent(ws).find(
      (e) => (e as { type?: string }).type === "backpressure",
    ) as Record<string, unknown>;
    expect(sent.episodeEnded).toBe(true);
    expect(sent.droppedBytes).toBe(12_288);
    expect(sent.droppedChunks).toBe(7);
  });

  it("survives a socket that throws mid-send", () => {
    ws.send.mockImplementationOnce(() => {
      throw new Error("socket closing");
    });
    expect(() => subscription(pty).onBackpressure?.(notice())).not.toThrow();
  });
});

describe("resync must not interleave with the attach replay", () => {
  it("drops a resync that arrives while the attach replay is still resolving", async () => {
    const pty = makePtyManager({ liveSnapshot: SNAP });
    const ws = makeWs();
    // Hold the ATTACH snapshot resolution open.
    let releaseAttach!: (v: unknown) => void;
    pty.__mocks.serializeMirrorIfLive.mockImplementationOnce(
      () => new Promise((r) => { releaseAttach = r; }),
    );

    const handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();

    // A resync lands mid-attach; it must NOT start a second sequence.
    handlers.onMessage?.(
      { data: JSON.stringify({ type: "resync" }) } as never,
      ws as never,
    );
    await flushAsync();
    expect(pty.__mocks.serializeMirrorIfLive).toHaveBeenCalledTimes(1);

    // Live output during the window stays BUFFERED — not sent ahead of the snapshot.
    subscription(pty).onData("MID-ATTACH");
    expect(
      readSent(ws).some((e) => (e as { payload?: string }).payload === "MID-ATTACH"),
    ).toBe(false);

    releaseAttach(SNAP);
    await flushAsync();

    // Exactly one snapshot, and the buffered output follows it.
    const types = readSent(ws).map((e) => (e as { type: string }).type);
    expect(types.filter((t) => t === "replay_snapshot")).toHaveLength(1);
    expect(types.indexOf("replay_snapshot")).toBeLessThan(types.lastIndexOf("data"));
    expect(
      readSent(ws).some((e) => (e as { payload?: string }).payload === "MID-ATTACH"),
    ).toBe(true);
  });

  it("serves a resync once the attach replay has settled", async () => {
    const pty = makePtyManager({ liveSnapshot: SNAP });
    const ws = makeWs();
    const handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
    handlers.onOpen?.({} as Event, ws as never);
    await flushAsync();
    pty.__mocks.serializeMirrorIfLive.mockClear();
    ws.send.mockClear();

    handlers.onMessage?.(
      { data: JSON.stringify({ type: "resync" }) } as never,
      ws as never,
    );
    await flushAsync();

    expect(pty.__mocks.serializeMirrorIfLive).toHaveBeenCalledTimes(1);
    expect(
      readSent(ws).filter((e) => (e as { type: string }).type === "replay_snapshot"),
    ).toHaveLength(1);
  });

  it("does not strand the gate when the attach replay throws", async () => {
    const pty = makePtyManager({ liveSnapshot: SNAP });
    const ws = makeWs();
    pty.__mocks.serializeMirrorIfLive.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handlers = buildWsHandlers(makeCtx({ ptyManager: pty }));
      handlers.onOpen?.({} as Event, ws as never);
      await flushAsync();
      pty.__mocks.serializeMirrorIfLive.mockClear();

      // A failed attach must still leave resync usable, or a broken first replay
      // would disable healing for the whole connection.
      handlers.onMessage?.(
        { data: JSON.stringify({ type: "resync" }) } as never,
        ws as never,
      );
      await flushAsync();
      expect(pty.__mocks.serializeMirrorIfLive).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
