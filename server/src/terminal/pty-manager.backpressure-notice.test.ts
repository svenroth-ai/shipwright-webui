/*
 * pty-manager.backpressure-notice.test.ts — the drop notice, end to end through
 * the real PtyManager (iterate-2026-07-30-terminal-ws-drop-resync, AC-1 + AC-2).
 *
 * `backpressure-telemetry.test.ts` pins the POLICY in isolation. This file pins the
 * WIRING, because that is where the old behaviour actually failed the user: the
 * pre-existing suite only asserted `backpressureFires >= 1`, which passes just as
 * well when the notice carries the first dropped chunk's size and nothing else —
 * the exact reason the losses were uncountable.
 *
 * Two properties that the isolated policy tests cannot show:
 *   - a saturation episode produces exactly TWO notices (open, then close on drain),
 *     not one per dropped chunk — pushing frames into a saturated socket is the one
 *     thing guaranteed not to arrive;
 *   - the CLOSING notice carries the accurate episode total, which is what the
 *     client acts on. Before this change the total was unknowable.
 *
 * A separate file rather than an addition to `pty-manager.test.ts`: that file sits
 * at its bloat-baseline ceiling, so growing it would trip the anti-ratchet gate.
 */

import { describe, it, expect } from "vitest";

import {
  PtyManager,
  type PtyHandleApi,
  type PtySpawnFn,
} from "./pty-manager.js";
import type { BackpressureNotice } from "./backpressure-telemetry.js";

interface FakePty extends PtyHandleApi {
  __emit(data: string): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const fake: FakePty = {
    onData(cb) {
      dataListeners.push(cb);
      return { dispose() {} };
    },
    onExit() {
      return { dispose() {} };
    },
    write() {},
    resize() {},
    kill() {},
    pause() {},
    resume() {},
    __emit(data) {
      for (const l of dataListeners) l(data);
    },
  };
  return fake;
}

function makeSpawn(): { fn: PtySpawnFn; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  return {
    fn: (() => {
      last = createFakePty();
      return last;
    }) as PtySpawnFn,
    lastPty: () => {
      if (!last) throw new Error("no pty spawned yet");
      return last;
    },
  };
}

const TASK = "11111111-2222-3333-4444-555555555555";

/** A WS-ish connection whose `bufferedAmount` the test drives directly. */
function makeConn(id: string) {
  return { id, bufferedAmount: 0 };
}

function boot(wsBufferBytes = 64) {
  const spawn = makeSpawn();
  const mgr = new PtyManager({ spawn: spawn.fn, wsBufferBytes, idleTimeoutMs: 60_000 });
  mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
  const conn = makeConn("A");
  const notices: BackpressureNotice[] = [];
  const delivered: string[] = [];
  mgr.attach(TASK, conn);
  mgr.subscribeForConnection(TASK, conn, {
    onData: (d) => delivered.push(d),
    onBackpressure: (n) => notices.push(n),
  });
  return { mgr, spawn, conn, notices, delivered };
}

describe("PtyManager — backpressure notice wiring", () => {
  it("opens with one notice, stays quiet while saturated, then closes on drain", () => {
    const { spawn, conn, notices, delivered } = boot();

    conn.bufferedAmount = 1_000; // saturated
    spawn.lastPty().__emit("AAAA");
    spawn.lastPty().__emit("BBBB");
    spawn.lastPty().__emit("CCCC");

    // One notice for the episode, not one per dropped chunk.
    expect(notices).toHaveLength(1);
    expect(notices[0].episodeEnded).toBe(false);
    expect(notices[0].episode).toBe(1);
    expect(delivered.join("")).not.toContain("AAAA");

    conn.bufferedAmount = 0; // drained
    spawn.lastPty().__emit("DD");

    expect(notices).toHaveLength(2);
    expect(delivered.join("")).toContain("DD");
  });

  it("the CLOSING notice carries the accurate episode total (the countability fix)", () => {
    const { spawn, conn, notices } = boot();

    conn.bufferedAmount = 1_000;
    spawn.lastPty().__emit("AAAA"); // 4 bytes
    spawn.lastPty().__emit("BBBBBB"); // 6
    spawn.lastPty().__emit("CC"); // 2
    conn.bufferedAmount = 0;
    spawn.lastPty().__emit("D");

    const closing = notices.at(-1)!;
    expect(closing.episodeEnded).toBe(true);
    expect(closing.droppedBytes).toBe(12);
    expect(closing.droppedChunks).toBe(3);
    expect(closing.totalDroppedBytes).toBe(12);
    // The OPENING notice could only ever have reported the first chunk.
    expect(notices[0].droppedBytes).toBe(4);
  });

  it("counts a second episode separately while lifetime totals accumulate", () => {
    const { spawn, conn, notices } = boot();

    conn.bufferedAmount = 1_000;
    spawn.lastPty().__emit("1234");
    conn.bufferedAmount = 0;
    spawn.lastPty().__emit("ok");

    conn.bufferedAmount = 1_000;
    spawn.lastPty().__emit("56789");
    conn.bufferedAmount = 0;
    spawn.lastPty().__emit("ok");

    const second = notices.at(-1)!;
    expect(second.episode).toBe(2);
    expect(second.droppedBytes).toBe(5);
    expect(second.totalDroppedBytes).toBe(9);
  });

  it("emits no notice at all when the socket never saturates", () => {
    const { spawn, conn, notices, delivered } = boot();
    conn.bufferedAmount = 0;
    spawn.lastPty().__emit("hello");
    spawn.lastPty().__emit("world");
    expect(notices).toHaveLength(0);
    expect(delivered.join("")).toBe("helloworld");
  });

  it("keeps delivering to a healthy connection while another is saturated", () => {
    const { mgr, spawn, conn, notices } = boot();
    const other = makeConn("B");
    const otherDelivered: string[] = [];
    mgr.attach(TASK, other);
    mgr.subscribeForConnection(TASK, other, {
      onData: (d) => otherDelivered.push(d),
    });

    conn.bufferedAmount = 1_000; // A saturated, B fine
    spawn.lastPty().__emit("PAYLOAD");

    expect(notices).toHaveLength(1);
    expect(otherDelivered.join("")).toContain("PAYLOAD");
  });
});
