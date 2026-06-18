/*
 * wsHeartbeat — unit tests for the pure client liveness state machine +
 * the scheduler-seam wiring. Mirrors the server-side ws-heartbeat contract
 * (createHeartbeatMonitor) so client and server reap dead sockets on the
 * same missed-pong tolerance.
 */

import { describe, expect, it } from "vitest";
import {
  createWsHeartbeatMonitor,
  startClientHeartbeat,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_MAX_MISSED,
} from "./wsHeartbeat";

describe("createWsHeartbeatMonitor", () => {
  it("returns 'ping' until maxMissed unanswered ticks, then 'terminate'", () => {
    const m = createWsHeartbeatMonitor(2);
    expect(m.tick()).toBe("ping"); // pingsSincePong 0 -> 1
    expect(m.tick()).toBe("ping"); // 1 -> 2
    expect(m.tick()).toBe("terminate"); // 2 >= 2
  });

  it("notePong resets the missed-pong run", () => {
    const m = createWsHeartbeatMonitor(2);
    m.tick(); // 1
    m.tick(); // 2
    m.notePong(); // reset to 0
    expect(m.tick()).toBe("ping"); // 0 -> 1, NOT terminate
    expect(m.tick()).toBe("ping"); // 1 -> 2
    expect(m.tick()).toBe("terminate");
  });

  it("defaults maxMissed to WS_HEARTBEAT_MAX_MISSED", () => {
    const m = createWsHeartbeatMonitor();
    for (let i = 0; i < WS_HEARTBEAT_MAX_MISSED; i++) {
      expect(m.tick()).toBe("ping");
    }
    expect(m.tick()).toBe("terminate");
  });
});

describe("startClientHeartbeat", () => {
  /** Manual scheduler seam — capture the interval handler to fire by hand. */
  function makeScheduler() {
    let handler: (() => void) | null = null;
    let cleared = false;
    return {
      setIntervalFn: (h: () => void) => {
        handler = h;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {
        cleared = true;
      },
      fire: () => handler?.(),
      get cleared() {
        return cleared;
      },
    };
  }

  it("sends a ping on each tick while the socket is open and alive", () => {
    const s = makeScheduler();
    let pings = 0;
    let dead = false;
    const hb = startClientHeartbeat({
      isOpen: () => true,
      sendPing: () => (pings += 1),
      onDead: () => (dead = true),
      maxMissed: 2,
      setIntervalFn: s.setIntervalFn,
      clearIntervalFn: s.clearIntervalFn,
    });
    s.fire(); // tick 1 -> ping
    hb.notePong();
    s.fire(); // tick 2 -> ping (reset by pong)
    hb.notePong();
    expect(pings).toBe(2);
    expect(dead).toBe(false);
    hb.stop();
  });

  it("calls onDead and self-stops after maxMissed unanswered ticks", () => {
    const s = makeScheduler();
    let dead = 0;
    const hb = startClientHeartbeat({
      isOpen: () => true,
      sendPing: () => undefined,
      onDead: () => (dead += 1),
      maxMissed: 2,
      setIntervalFn: s.setIntervalFn,
      clearIntervalFn: s.clearIntervalFn,
    });
    s.fire(); // 1 -> ping
    s.fire(); // 2 -> ping
    s.fire(); // 3 -> terminate -> onDead + stop
    expect(dead).toBe(1);
    expect(s.cleared).toBe(true);
    // Idempotent: a stray late fire after self-stop does NOT re-trigger.
    s.fire();
    expect(dead).toBe(1);
    hb.stop();
  });

  it("self-stops (no ping, no onDead) once the socket leaves OPEN", () => {
    const s = makeScheduler();
    let pings = 0;
    let dead = 0;
    let open = true;
    const hb = startClientHeartbeat({
      isOpen: () => open,
      sendPing: () => (pings += 1),
      onDead: () => (dead += 1),
      setIntervalFn: s.setIntervalFn,
      clearIntervalFn: s.clearIntervalFn,
    });
    open = false;
    s.fire();
    expect(pings).toBe(0);
    expect(dead).toBe(0);
    expect(s.cleared).toBe(true);
    hb.stop();
  });

  it("uses WS_HEARTBEAT_INTERVAL_MS as the default interval", () => {
    let seenMs = -1;
    const hb = startClientHeartbeat({
      isOpen: () => true,
      sendPing: () => undefined,
      onDead: () => undefined,
      setIntervalFn: (_h, ms) => {
        seenMs = ms;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => undefined,
    });
    expect(seenMs).toBe(WS_HEARTBEAT_INTERVAL_MS);
    hb.stop();
  });
});
