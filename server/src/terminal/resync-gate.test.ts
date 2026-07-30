/*
 * resync-gate.test.ts — resync admission policy
 * (iterate-2026-07-30-terminal-ws-drop-resync, AC-3).
 *
 * What these tests fence: a resync is cheap to ASK for and expensive to SERVE
 * (M2 double-serialize). The gate must admit the resync that repairs a real drop
 * while refusing a spam loop, and it must never latch shut — a gate that forgets
 * to reopen would silently disable healing for the rest of the connection, which
 * is the failure mode that matters most here.
 */

import { describe, it, expect } from "vitest";
import {
  createResyncGate,
  DEFAULT_RESYNC_MIN_INTERVAL_MS,
} from "./resync-gate.js";

function harness(minIntervalMs = DEFAULT_RESYNC_MIN_INTERVAL_MS) {
  let t = 10_000;
  const gate = createResyncGate({ now: () => t, minIntervalMs });
  return { gate, advance: (ms: number) => { t += ms; } };
}

describe("createResyncGate", () => {
  it("admits the first request", () => {
    const { gate } = harness();
    expect(gate.tryAcquire()).toBe(true);
  });

  it("refuses a second request while one is in flight", () => {
    const { gate } = harness();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.deniedCount()).toBe(2);
  });

  it("refuses a request inside the minimum interval even after release", () => {
    const { gate, advance } = harness(1_000);
    expect(gate.tryAcquire()).toBe(true);
    gate.release();
    advance(999);
    expect(gate.tryAcquire()).toBe(false);
  });

  it("admits again once the interval has elapsed", () => {
    const { gate, advance } = harness(1_000);
    expect(gate.tryAcquire()).toBe(true);
    gate.release();
    advance(1_000);
    expect(gate.tryAcquire()).toBe(true);
  });

  it("does NOT latch shut — release reopens the gate for later drops", () => {
    const { gate, advance } = harness(1_000);
    for (let i = 0; i < 5; i++) {
      expect(gate.tryAcquire()).toBe(true);
      gate.release();
      advance(1_000);
    }
  });

  it("survives a release() that never had a matching acquire", () => {
    const { gate } = harness(1_000);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
  });

  it("a spam loop is admitted exactly once per interval, not once per request", () => {
    const { gate, advance } = harness(1_000);
    let admitted = 0;
    for (let i = 0; i < 300; i++) {
      if (gate.tryAcquire()) {
        admitted += 1;
        gate.release();
      }
      advance(10); // 300 requests spread over 3 s
    }
    // 3 s of requests at a 1 s floor -> 3 admissions (t=0, 1 s, 2 s).
    expect(admitted).toBe(3);
    expect(gate.deniedCount()).toBe(297);
  });
});
