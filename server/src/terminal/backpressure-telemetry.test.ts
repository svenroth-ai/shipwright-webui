/*
 * backpressure-telemetry.test.ts — the drop path must be countable and must
 * leave evidence (iterate-2026-07-30-terminal-ws-drop-resync, AC-1 + AC-2).
 *
 * The defect these tests fence: the path shipped SILENT (no logging at all, so it
 * was unproven it ever fired) and notified once per episode carrying only the
 * FIRST chunk's size, so losses could not be summed even in principle.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BackpressureTelemetry,
  DEFAULT_LOG_INTERVAL_MS,
} from "./backpressure-telemetry.js";

const TASK = "11111111-2222-3333-4444-555555555555";

function harness(logIntervalMs = DEFAULT_LOG_INTERVAL_MS) {
  const lines: string[] = [];
  let t = 1_000;
  const tel = new BackpressureTelemetry({
    now: () => t,
    log: (m) => lines.push(m),
    logIntervalMs,
  });
  return {
    tel,
    lines,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("BackpressureTelemetry — accounting (AC-2: losses are countable)", () => {
  it("notifies on the drop that OPENS an episode", () => {
    const { tel } = harness();
    const conn = {};
    const n = tel.onDrop(TASK, conn, 500);
    expect(n).not.toBeNull();
    expect(n).toEqual({
      droppedBytes: 500,
      droppedChunks: 1,
      totalDroppedBytes: 500,
      episode: 1,
      episodeEnded: false,
    });
  });

  it("stays silent on further drops within the same episode but keeps counting", () => {
    const { tel } = harness();
    const conn = {};
    tel.onDrop(TASK, conn, 500);
    expect(tel.onDrop(TASK, conn, 300)).toBeNull();
    expect(tel.onDrop(TASK, conn, 200)).toBeNull();
    const s = tel.stats(conn);
    expect(s?.episodeBytes).toBe(1000);
    expect(s?.episodeChunks).toBe(3);
    expect(s?.totalDroppedBytes).toBe(1000);
    expect(s?.totalDroppedChunks).toBe(3);
  });

  it("closes the episode with the ACCURATE total — the countability fix", () => {
    const { tel } = harness();
    const conn = {};
    tel.onDrop(TASK, conn, 500);
    tel.onDrop(TASK, conn, 300);
    tel.onDrop(TASK, conn, 200);
    const closing = tel.onDelivered(TASK, conn);
    // The old behaviour could only ever report 500 (the first chunk).
    expect(closing).toEqual({
      droppedBytes: 1000,
      droppedChunks: 3,
      totalDroppedBytes: 1000,
      episode: 1,
      episodeEnded: true,
    });
  });

  it("returns null from onDelivered when no episode is open (hot path)", () => {
    const { tel } = harness();
    const conn = {};
    expect(tel.onDelivered(TASK, conn)).toBeNull();
    tel.onDrop(TASK, conn, 10);
    tel.onDelivered(TASK, conn);
    expect(tel.onDelivered(TASK, conn)).toBeNull();
  });

  it("counts a SECOND episode separately while lifetime totals accumulate", () => {
    const { tel } = harness();
    const conn = {};
    tel.onDrop(TASK, conn, 100);
    tel.onDelivered(TASK, conn);
    const second = tel.onDrop(TASK, conn, 70);
    expect(second).toEqual({
      droppedBytes: 70,
      droppedChunks: 1,
      totalDroppedBytes: 170,
      episode: 2,
      episodeEnded: false,
    });
  });

  it("keeps accounting per connection, not per task", () => {
    const { tel } = harness();
    const a = {};
    const b = {};
    tel.onDrop(TASK, a, 100);
    tel.onDrop(TASK, a, 100);
    const forB = tel.onDrop(TASK, b, 5);
    // b is a fresh connection: its own episode 1, its own totals.
    expect(forB?.episode).toBe(1);
    expect(forB?.totalDroppedBytes).toBe(5);
    expect(tel.stats(a)?.totalDroppedBytes).toBe(200);
  });

  it("forgets a released connection", () => {
    const { tel } = harness();
    const conn = {};
    tel.onDrop(TASK, conn, 42);
    tel.release(conn);
    expect(tel.stats(conn)).toBeUndefined();
    // A later drop starts over rather than resurrecting stale counters.
    expect(tel.onDrop(TASK, conn, 1)?.episode).toBe(1);
  });
});

describe("BackpressureTelemetry — logging (AC-1: the path is no longer silent)", () => {
  it("logs when an episode opens, naming the task and that bytes are unrecoverable", () => {
    const { tel, lines } = harness();
    tel.onDrop(TASK, {}, 2048);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(TASK);
    expect(lines[0]).toContain("2048B");
    expect(lines[0]).toMatch(/never resent/i);
  });

  it("logs the episode close with the episode and session totals", () => {
    const { tel, lines, advance } = harness(1_000);
    const conn = {};
    tel.onDrop(TASK, conn, 1000);
    tel.onDrop(TASK, conn, 500);
    advance(1_000); // clear the throttle so the close line is emitted
    tel.onDelivered(TASK, conn);
    const closing = lines[lines.length - 1];
    expect(closing).toMatch(/drained/i);
    expect(closing).toContain("1500B");
    expect(closing).toContain("2 chunks");
  });

  it("throttles mid-episode lines so a saturation storm cannot flood the log", () => {
    const { tel, lines, advance } = harness(5_000);
    const conn = {};
    tel.onDrop(TASK, conn, 10); // first line for this conn -> always emits
    for (let i = 0; i < 500; i++) tel.onDrop(TASK, conn, 10);
    expect(lines).toHaveLength(1);

    advance(5_000);
    tel.onDrop(TASK, conn, 10); // window elapsed -> one more line
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/still saturated/i);

    for (let i = 0; i < 500; i++) tel.onDrop(TASK, conn, 10);
    expect(lines).toHaveLength(2);
  });

  /*
   * External review, medium: throttling ONLY mid-episode lines still floods. A
   * connection whose bufferedAmount flaps across the threshold opens and closes an
   * episode per flap, so unconditional transition logging emits two lines per flap
   * forever — the very thing AC-1 forbids.
   */
  it("throttles episode TRANSITIONS too, so a flapping socket cannot flood", () => {
    const { tel, lines, advance } = harness(5_000);
    const conn = {};
    for (let i = 0; i < 200; i++) {
      tel.onDrop(TASK, conn, 10); // opens an episode
      tel.onDelivered(TASK, conn); // closes it again
      advance(5); // 200 flaps inside one throttle window
    }
    expect(lines).toHaveLength(1);
  });

  it("discloses how many lines the throttle withheld", () => {
    const { tel, lines, advance } = harness(5_000);
    const conn = {};
    tel.onDrop(TASK, conn, 10);
    for (let i = 0; i < 4; i++) {
      tel.onDelivered(TASK, conn);
      tel.onDrop(TASK, conn, 10);
    }
    advance(5_000);
    tel.onDrop(TASK, conn, 10);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/\+\d+ similar suppressed/);
  });

  it("still counts every byte while lines are suppressed — volume is never lost", () => {
    const { tel, lines, advance } = harness(60_000);
    const conn = {};
    for (let i = 0; i < 100; i++) tel.onDrop(TASK, conn, 100);
    expect(lines).toHaveLength(1); // heavily throttled
    expect(tel.stats(conn)?.totalDroppedBytes).toBe(10_000);
    advance(60_000);
    tel.onDrop(TASK, conn, 1);
    expect(lines[1]).toContain("10001B");
  });

  it("always emits the FIRST line for a connection, whatever the throttle", () => {
    const { tel, lines } = harness(60_000);
    tel.onDrop(TASK, {}, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/saturated — DISCARDING/);
  });

  it("accepts a PRIMITIVE connection key without throwing", () => {
    // PtyManager types a connection as `unknown` and its API permits a primitive;
    // a WeakMap key would throw a TypeError on the hot delivery path (external review).
    const { tel } = harness();
    expect(() => tel.onDrop(TASK, "conn-as-string", 10)).not.toThrow();
    expect(tel.stats("conn-as-string")?.totalDroppedBytes).toBe(10);
    tel.release("conn-as-string");
    expect(tel.stats("conn-as-string")).toBeUndefined();
  });

  it("defaults to console.warn when no log sink is injected", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      new BackpressureTelemetry().onDrop(TASK, {}, 1);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
