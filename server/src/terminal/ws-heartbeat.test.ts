/*
 * ws-heartbeat.test.ts — RED-first tests for the embedded-terminal WS
 * liveness keepalive (iterate-2026-05-31-terminal-readonly-keepalive).
 *
 * Covers the pure liveness monitor, the env interval resolver, and the
 * thin self-cleaning wiring — all WITHOUT real timers or real sockets
 * (injected scheduler + fake `raw`). The reap path is deterministic:
 * a fake raw that never pongs MUST be terminate()d after a bounded
 * number of ticks, mirroring the prod failure mode (half-open TCP).
 *
 * The monitor tolerates ONE transient missed pong before reaping
 * (DEFAULT_MAX_MISSED_PONGS = 2) so an OS-sleep resume — where the
 * server's interval and the peer wake on slightly different ticks —
 * does not spuriously reap a healthy connection (internal review
 * finding #2, 2026-05-31).
 */

import { describe, it, expect, vi } from "vitest";

import {
  createHeartbeatMonitor,
  resolveHeartbeatMs,
  startWsHeartbeat,
  DEFAULT_HEARTBEAT_MS,
  MIN_HEARTBEAT_MS,
  MAX_HEARTBEAT_MS,
  DEFAULT_MAX_MISSED_PONGS,
} from "./ws-heartbeat.js";

describe("createHeartbeatMonitor", () => {
  it("terminates only after consecutive missed pongs (default tolerance = 1)", () => {
    const m = createHeartbeatMonitor();
    expect(m.tick()).toBe("ping"); // 1 ping outstanding
    expect(m.tick()).toBe("ping"); // one interval missed — still tolerated
    expect(m.tick()).toBe("terminate"); // second missed interval → reap
  });

  it("never terminates while a pong arrives each interval", () => {
    const m = createHeartbeatMonitor();
    for (let i = 0; i < 10; i++) {
      expect(m.tick()).toBe("ping");
      m.notePong();
    }
  });

  it("a late pong within the tolerance window prevents termination", () => {
    const m = createHeartbeatMonitor();
    expect(m.tick()).toBe("ping");
    expect(m.tick()).toBe("ping"); // one missed interval (not yet reaped)
    m.notePong(); // late pong arrives before the reap tick
    expect(m.tick()).toBe("ping"); // recovered → ping, not terminate
  });

  it("stays terminate once dead (idempotent)", () => {
    const m = createHeartbeatMonitor();
    expect(m.tick()).toBe("ping");
    expect(m.tick()).toBe("ping");
    expect(m.tick()).toBe("terminate");
    expect(m.tick()).toBe("terminate");
  });

  it("honours a custom tolerance (maxMissedPongs = 1 → classic 2-tick reaper)", () => {
    const m = createHeartbeatMonitor(1);
    expect(m.tick()).toBe("ping");
    expect(m.tick()).toBe("terminate");
  });

  it("exposes a tolerance default of 2", () => {
    expect(DEFAULT_MAX_MISSED_PONGS).toBe(2);
  });
});

describe("resolveHeartbeatMs", () => {
  it("defaults when unset", () => {
    expect(resolveHeartbeatMs({})).toBe(DEFAULT_HEARTBEAT_MS);
  });
  it("honours a valid override", () => {
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "5000" }),
    ).toBe(5000);
  });
  it("clamps below-floor values up to the floor", () => {
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "10" }),
    ).toBe(MIN_HEARTBEAT_MS);
  });
  it("clamps above-ceiling values down to the ceiling (can't silently disable the reaper)", () => {
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "86400000" }),
    ).toBe(MAX_HEARTBEAT_MS);
  });
  it("falls back to default on non-numeric / non-positive input", () => {
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "abc" }),
    ).toBe(DEFAULT_HEARTBEAT_MS);
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "0" }),
    ).toBe(DEFAULT_HEARTBEAT_MS);
    expect(
      resolveHeartbeatMs({ SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS: "-50" }),
    ).toBe(DEFAULT_HEARTBEAT_MS);
  });
});

const WS_OPEN = 1;
const WS_CLOSED = 3;

interface FakeRaw {
  readyState: number;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: (ev: string, cb: () => void) => void;
  off: ReturnType<typeof vi.fn>;
  _pong: () => void;
}

function makeRaw(): FakeRaw {
  const raw: FakeRaw = {
    readyState: WS_OPEN,
    ping: vi.fn(),
    terminate: vi.fn(),
    on: (ev, cb) => {
      if (ev === "pong") raw._pong = cb;
    },
    off: vi.fn(),
    _pong: () => undefined,
  };
  return raw;
}

function makeScheduler() {
  let cb: (() => void) | null = null;
  const setIntervalFn = vi.fn((fn: () => void) => {
    cb = fn;
    return 7 as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalFn = vi.fn(() => {
    cb = null; // a cleared interval never fires again (mirrors real timers)
  });
  return {
    setIntervalFn,
    clearIntervalFn,
    tick: () => {
      if (cb) cb();
    },
    armed: () => cb !== null,
  };
}

// Tighten the reaper to the classic 2-tick budget for the wiring tests so
// "dead → terminate" is reached in two ticks; the tolerance itself is
// exercised by the monitor tests above.
const REAP_FAST = { maxMissedPongs: 1 } as const;

describe("startWsHeartbeat", () => {
  it("pings each tick and terminates a dead socket exactly once", () => {
    const raw = makeRaw();
    const s = makeScheduler();
    startWsHeartbeat(
      { raw },
      {
        ...REAP_FAST,
        setIntervalFn: s.setIntervalFn,
        clearIntervalFn: s.clearIntervalFn,
      },
    );
    s.tick();
    expect(raw.ping).toHaveBeenCalledTimes(1);
    expect(raw.terminate).not.toHaveBeenCalled();
    // No pong arrived → next tick terminates AND stops the loop (one-shot).
    s.tick();
    expect(raw.terminate).toHaveBeenCalledTimes(1);
    expect(s.clearIntervalFn).toHaveBeenCalledTimes(1);
    // The interval is cleared → any further scheduler fire is a no-op,
    // so terminate() fires exactly once even on a misbehaving socket.
    s.tick();
    expect(raw.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates exactly once even if terminate() throws (readyState stays OPEN)", () => {
    const raw = makeRaw();
    // Pathological: terminate() throws and the socket never flips state.
    raw.terminate = vi.fn(() => {
      throw new Error("terminate boom");
    });
    const s = makeScheduler();
    startWsHeartbeat(
      { raw },
      {
        ...REAP_FAST,
        setIntervalFn: s.setIntervalFn,
        clearIntervalFn: s.clearIntervalFn,
      },
    );
    s.tick(); // ping
    s.tick(); // terminate throws → must still stop the loop
    expect(raw.terminate).toHaveBeenCalledTimes(1);
    expect(s.clearIntervalFn).toHaveBeenCalledTimes(1);
    s.tick(); // no-op (cleared) → no second terminate
    expect(raw.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not terminate while the peer pongs", () => {
    const raw = makeRaw();
    const s = makeScheduler();
    startWsHeartbeat(
      { raw },
      { setIntervalFn: s.setIntervalFn, clearIntervalFn: s.clearIntervalFn },
    );
    for (let i = 0; i < 5; i++) {
      s.tick();
      raw._pong(); // browser auto-pong
    }
    expect(raw.terminate).not.toHaveBeenCalled();
    expect(raw.ping).toHaveBeenCalledTimes(5);
  });

  it("self-cleans when the socket is no longer OPEN", () => {
    const raw = makeRaw();
    const s = makeScheduler();
    const stop = startWsHeartbeat(
      { raw },
      { setIntervalFn: s.setIntervalFn, clearIntervalFn: s.clearIntervalFn },
    );
    raw.readyState = WS_CLOSED;
    s.tick();
    expect(s.clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(raw.ping).not.toHaveBeenCalled();
    // stop() after self-clean is harmless / idempotent.
    expect(() => stop()).not.toThrow();
  });

  it("stop() clears the interval and removes the pong listener", () => {
    const raw = makeRaw();
    const s = makeScheduler();
    const stop = startWsHeartbeat(
      { raw },
      { setIntervalFn: s.setIntervalFn, clearIntervalFn: s.clearIntervalFn },
    );
    stop();
    expect(s.clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(raw.off).toHaveBeenCalledWith("pong", expect.any(Function));
    // Idempotent.
    stop();
    expect(s.clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it("no-ops (no throw, no scheduling) when raw is missing or partial", () => {
    const s1 = makeScheduler();
    const stop1 = startWsHeartbeat(
      {},
      { setIntervalFn: s1.setIntervalFn, clearIntervalFn: s1.clearIntervalFn },
    );
    expect(s1.armed()).toBe(false);
    expect(() => stop1()).not.toThrow();

    const s2 = makeScheduler();
    // raw without ping/terminate/on → degrade to no-op.
    const stop2 = startWsHeartbeat(
      { raw: { readyState: WS_OPEN } },
      { setIntervalFn: s2.setIntervalFn, clearIntervalFn: s2.clearIntervalFn },
    );
    expect(s2.armed()).toBe(false);
    expect(() => stop2()).not.toThrow();
  });
});
