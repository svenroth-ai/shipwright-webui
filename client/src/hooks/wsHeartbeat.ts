/*
 * wsHeartbeat — pure client-side WS liveness state machine + scheduler-seam
 * wiring (iterate-2026-06-18-terminal-ws-reconnect-refocus).
 *
 * Mirrors server/src/terminal/ws-heartbeat.ts (createHeartbeatMonitor) so
 * client and server reap dead sockets on the SAME missed-pong tolerance.
 * The controller that owns the browser-event wiring lives in `wsLiveness.ts`.
 *
 * WHY: a browser learns a socket is dead only via the `close` event, which a
 * full sleep / Tailscale partition (the prod server binds the Tailscale IP)
 * never delivers. The client sends `{type:"ping"}`, the server replies
 * `{type:"pong"}` (handled before the role gate in `ws-upgrade-handler.ts`);
 * a missed-pong run reaps the socket via `onDead`.
 */

/** Heartbeat cadence. Matches the server's DEFAULT_HEARTBEAT_MS. */
export const WS_HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * Consecutive unanswered pings tolerated before reap. `2` survives ONE
 * transient miss (OS-sleep resume can drop a single tick) while still reaping
 * a truly dead socket within ~2-3 intervals. Matches DEFAULT_MAX_MISSED_PONGS.
 */
export const WS_HEARTBEAT_MAX_MISSED = 2;
/**
 * Eager-probe deadline used on a tab refocus when the socket still reports
 * OPEN — short so a returning user recovers in a few seconds instead of
 * waiting for the next ~15 s heartbeat tick.
 */
export const WS_REFOCUS_PROBE_MS = 4_000;

/**
 * Opaque timer-handle type. Browser `setInterval` returns `number`, Node
 * returns `Timeout`; the client tsconfig sees both lib sets, so we pin one
 * alias and cast the global fallbacks to it (avoids a `number | Timeout`
 * union at the assignment site).
 */
export type HeartbeatTimer = ReturnType<typeof setInterval>;

export interface WsHeartbeatMonitor {
  /** Record any inbound traffic — the peer is alive. */
  notePong(): void;
  /** Advance one interval: `terminate` once tolerance is exhausted, else `ping`. */
  tick(): "ping" | "terminate";
}

/**
 * Pure liveness state machine. No timers, no sockets. Tracks pings sent since
 * the last inbound message; any inbound resets it. Reaps once that count
 * reaches `maxMissed`.
 */
export function createWsHeartbeatMonitor(
  maxMissed: number = WS_HEARTBEAT_MAX_MISSED,
): WsHeartbeatMonitor {
  let pingsSincePong = 0;
  return {
    notePong() {
      pingsSincePong = 0;
    },
    tick() {
      if (pingsSincePong >= maxMissed) return "terminate";
      pingsSincePong += 1;
      return "ping";
    },
  };
}

export interface StartClientHeartbeatOpts {
  /** True while the underlying socket is OPEN. */
  isOpen(): boolean;
  /** Send one `{type:"ping"}` envelope on the socket. */
  sendPing(): void;
  /** Called once when the peer is declared dead (close + reconnect upstream). */
  onDead(): void;
  /** Override the interval (tests / tuning). */
  intervalMs?: number;
  /** Override the missed-ping tolerance (tests / tuning). */
  maxMissed?: number;
  /** Scheduler seams for deterministic tests. */
  setIntervalFn?: (handler: () => void, ms: number) => HeartbeatTimer;
  clearIntervalFn?: (timer: HeartbeatTimer) => void;
}

export interface ClientHeartbeatHandle {
  /** Feed an inbound message into the monitor (resets the missed run). */
  notePong(): void;
  /** Idempotent teardown. */
  stop(): void;
}

/**
 * Attach a self-cleaning liveness heartbeat to one WebSocket connection. The
 * loop self-stops on the first tick after the socket leaves OPEN, and on the
 * reap tick it fires `onDead` EXACTLY ONCE (then stops), so a stray late timer
 * cannot double-fire.
 */
export function startClientHeartbeat(
  opts: StartClientHeartbeatOpts,
): ClientHeartbeatHandle {
  const monitor = createWsHeartbeatMonitor(opts.maxMissed);
  const intervalMs = opts.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const setI: (handler: () => void, ms: number) => HeartbeatTimer =
    opts.setIntervalFn ??
    (setInterval as unknown as (handler: () => void, ms: number) => HeartbeatTimer);
  const clearI: (timer: HeartbeatTimer) => void =
    opts.clearIntervalFn ??
    (clearInterval as unknown as (timer: HeartbeatTimer) => void);

  let timer: HeartbeatTimer | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearI(timer);
      timer = null;
    }
  };

  timer = setI(() => {
    if (stopped) return;
    if (!opts.isOpen()) {
      stop();
      return;
    }
    if (monitor.tick() === "terminate") {
      opts.onDead();
      stop();
      return;
    }
    opts.sendPing();
  }, intervalMs);

  return { notePong: () => monitor.notePong(), stop };
}
