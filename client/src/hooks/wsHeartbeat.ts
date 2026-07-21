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
 * Steady retry cadence once the fast reconnect ramp
 * (`BACKOFF_MS = [200,400,800,1600,3200]`, ~6.2 s total) is spent.
 *
 * WHY THIS EXISTS (iterate-2026-07-21-mac-sleep-terminal-frozen): the ramp used
 * to be a hard 5-attempt CAP. After an OS sleep/resume the refocus probe reaps
 * the half-open socket and spends the whole ramp inside ~6.2 s — but a tunnelled
 * network (Tailscale) can need appreciably longer than that to become routable
 * again after a resume. Every attempt then failed against a network that could
 * not answer yet, the cap was reached, and `scheduleReconnect` returned early
 * FOREVER while the per-connection heartbeat was already stopped: **zero armed
 * timers**, so nothing could observe the network coming back. Recovery waited on
 * a later incidental `focus`/`visibilitychange`, which is why the terminal
 * appeared frozen for ~30 s and why only a tab refresh reliably fixed it.
 *
 * The cap's legitimate intent — do not hammer a dead server at 200 ms forever —
 * is preserved: after the ramp we settle here and retry at a calm, bounded rate
 * indefinitely. Time-to-network-return cannot be measured or bounded from the
 * client, so ANY fixed budget is a guess; never going inert is the property that
 * actually matters. 5 s keeps worst-case recovery well inside a human's patience
 * while costing one failed connect per 5 s against a genuinely dead server.
 */
export const WS_RECONNECT_TAIL_MS = 5_000;

/**
 * How many 5 s tail attempts before backing off to `WS_RECONNECT_TAIL_SLOW_MS`.
 * 12 ≈ one minute of prompt retrying, which covers any realistic OS-resume /
 * tunnel-renegotiation window.
 */
export const WS_RECONNECT_TAIL_SLOW_AFTER = 12;

/**
 * Tail cadence once an outage has clearly stopped being transient.
 *
 * Not every failure recovers: a task whose cwd was deleted (a removed worktree
 * is routine in this repo) makes the server reject the WS upgrade
 * DETERMINISTICALLY, and a rejected upgrade is indistinguishable client-side
 * from a transient one. Without this step an unattended tab would do realpath
 * I/O and emit a server warn every 5 s indefinitely (external code review,
 * MEDIUM). Backing off cuts that ~6× while preserving the property that
 * actually matters: a retry is ALWAYS armed.
 */
export const WS_RECONNECT_TAIL_SLOW_MS = 30_000;

/**
 * Watchdog for a single connect ATTEMPT that never resolves.
 *
 * The retry tail is driven by the `close` event: an attempt that fails schedules
 * the next one. But a socket can sit in `CONNECTING` indefinitely — a SYN into a
 * blackholed route is exactly what a half-restored tunnel produces after an OS
 * resume, and the browser's own connect timeout is minutes long. No `close`
 * would fire, so no retry would ever be scheduled and the client would be right
 * back in the inert state this iterate exists to remove (external code review,
 * openai MEDIUM). Closing a stuck attempt fires `close`, which re-enters the
 * normal retry path.
 *
 * 10 s is comfortably above a healthy LAN/tailnet handshake while keeping
 * worst-case recovery at roughly one watchdog plus one tail interval.
 */
export const WS_CONNECT_TIMEOUT_MS = 10_000;

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
