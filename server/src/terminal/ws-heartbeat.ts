/*
 * ws-heartbeat.ts — embedded-terminal WebSocket liveness keepalive
 * (iterate-2026-05-31-terminal-readonly-keepalive).
 *
 * WHY THIS EXISTS
 * ---------------
 * The terminal writer slot (`pty-manager.ts`) is released ONLY when the
 * server observes a WS `close`/`error` event (`detachAndCount` in
 * `ws-upgrade-handler.ts`). A connection that dies UNCLEANLY — OS sleep,
 * browser/tab crash, or a Tailscale half-open TCP (the prod server binds
 * the Tailscale IP) — never fires that event, so the writer slot stays
 * pinned to a dead conn. Every new tab then attaches as `reader` and shows
 * the false "Read-only — another tab is the active writer" banner. The
 * backpressure watchdog cannot help: it evicts on `bufferedAmount`
 * saturation, and an idle dead socket buffers ~0 bytes (in prod it is inert
 * anyway — the manager's `conn` is a synthetic token with no
 * `bufferedAmount`).
 *
 * This module adds a per-connection WS ping/pong heartbeat. On a missed
 * pong the dead socket is `terminate()`d; the existing
 * `onClose → detach → reader-promotion → onPromoteToWriter("writer-promoted")`
 * chain then frees the slot and promotes the surviving tab to writer —
 * clearing read-only WITHOUT a manual reload. The browser answers WS pings
 * automatically (RFC 6455 control frame), so there is no client change.
 *
 * COHESION (ADR-101/103): `pty-manager.ts` / `ws-upgrade-handler.ts` /
 * `terminal/routes.ts` are at-ceiling deep-module exceptions. The
 * liveness mechanics live HERE as a dedicated neutral module (the
 * ADR-103-sanctioned shape, cf. `terminal-reset.ts`) so the WS body only
 * gains a one-line wire. The pure monitor + env resolver are timer- and
 * socket-free for deterministic unit testing.
 */

/** Default heartbeat interval; a dead peer is reaped within ~2-3 intervals. */
export const DEFAULT_HEARTBEAT_MS = 15_000;
/** Floor — guards against a pathological tiny interval pinning the loop. */
export const MIN_HEARTBEAT_MS = 1_000;
/**
 * Ceiling — a larger interval would silently make the reaper effectively
 * inert and restore the exact bug this iterate fixes, so a misconfigured
 * env value is clamped down rather than trusted (internal review #3).
 */
export const MAX_HEARTBEAT_MS = 300_000;
/**
 * Consecutive missed pongs tolerated before a socket is reaped. `2` means
 * the connection survives ONE transient miss — important on OS-sleep
 * resume, where the server's interval and the peer wake on slightly
 * different ticks (internal review #2). A truly dead socket is still
 * reaped within ~2-3 intervals.
 */
export const DEFAULT_MAX_MISSED_PONGS = 2;
/** RFC 6455 OPEN readyState (ws@8 numeric constant). */
const WS_OPEN = 1;

/**
 * The slice of a `ws` (ws@8) socket we depend on, surfaced via
 * `WSContext.raw` (@hono/node-ws). Kept structural so tests can supply a
 * fake and so a future adapter that does not expose these methods degrades
 * to a no-op rather than throwing.
 */
export interface RawSocketLike {
  readyState: number;
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): void;
  off?(event: "pong", listener: () => void): void;
}

export interface HeartbeatMonitor {
  /** Record a pong from the peer — the connection is alive. */
  notePong(): void;
  /**
   * Decide this interval's action and advance state: `terminate` once the
   * tolerance of consecutive missed pongs is exhausted, otherwise `ping`.
   */
  tick(): "ping" | "terminate";
}

/**
 * Pure liveness state machine. No timers, no sockets — fully unit-testable.
 * Tracks pings sent since the last pong; a pong resets it. Reaps once that
 * count reaches `maxMissedPongs`, so a single transient miss is tolerated
 * at the default (see {@link DEFAULT_MAX_MISSED_PONGS}).
 */
export function createHeartbeatMonitor(
  maxMissedPongs: number = DEFAULT_MAX_MISSED_PONGS,
): HeartbeatMonitor {
  let pingsSincePong = 0;
  return {
    notePong() {
      pingsSincePong = 0;
    },
    tick() {
      if (pingsSincePong >= maxMissedPongs) return "terminate";
      pingsSincePong += 1;
      return "ping";
    },
  };
}

/**
 * Resolve the heartbeat interval from the environment. Invalid, absent, or
 * non-positive values fall back to {@link DEFAULT_HEARTBEAT_MS}; valid
 * values are clamped up to {@link MIN_HEARTBEAT_MS}.
 */
export function resolveHeartbeatMs(
  env: Record<string, string | undefined>,
): number {
  const raw = env.SHIPWRIGHT_TERMINAL_WS_HEARTBEAT_MS;
  if (raw === undefined) return DEFAULT_HEARTBEAT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HEARTBEAT_MS;
  return Math.min(Math.max(parsed, MIN_HEARTBEAT_MS), MAX_HEARTBEAT_MS);
}

export interface StartWsHeartbeatOpts {
  /** Override the resolved interval (tests). */
  intervalMs?: number;
  /** Consecutive missed pongs tolerated before reap (tests / tuning). */
  maxMissedPongs?: number;
  /** Env source for interval resolution (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Scheduler seams for deterministic tests. */
  setIntervalFn?: (
    handler: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

/**
 * Attach a self-cleaning liveness heartbeat to a WS connection. Returns a
 * `stop()` for explicit teardown; the loop ALSO self-cleans on the first
 * tick after `raw.readyState` leaves OPEN, so callers need not wire
 * `onClose`/`onError`.
 *
 * No-ops (returns a no-op `stop`) when the connection does not expose a
 * pingable raw socket — degrading to the pre-existing close-driven release
 * with no regression for tests/mocks or alternate adapters.
 */
export function startWsHeartbeat(
  ws: { raw?: unknown },
  opts?: StartWsHeartbeatOpts,
): () => void {
  const candidate = ws?.raw as Partial<RawSocketLike> | undefined;
  if (
    !candidate ||
    typeof candidate.ping !== "function" ||
    typeof candidate.terminate !== "function" ||
    typeof candidate.on !== "function"
  ) {
    return () => undefined;
  }
  const raw = candidate as RawSocketLike;

  const monitor = createHeartbeatMonitor(opts?.maxMissedPongs);
  const onPong = () => monitor.notePong();
  raw.on("pong", onPong);

  const intervalMs =
    opts?.intervalMs ?? resolveHeartbeatMs(opts?.env ?? process.env);
  const setI = opts?.setIntervalFn ?? setInterval;
  const clearI = opts?.clearIntervalFn ?? clearInterval;

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearI(timer);
      timer = null;
    }
    try {
      raw.off?.("pong", onPong);
    } catch {
      /* ignore */
    }
  };

  timer = setI(() => {
    if (raw.readyState !== WS_OPEN) {
      // Socket already closing/closed — the onClose path (if any) owns the
      // detach; we just release our own timer + listener.
      stop();
      return;
    }
    const action = monitor.tick();
    if (action === "terminate") {
      // Half-open / unresponsive: force the close so the existing
      // detach → reader-promotion chain runs, then stop ourselves so
      // terminate() fires EXACTLY ONCE — even if it throws or the
      // readyState flip is not synchronous (external review: openai
      // medium, 2026-05-31). Without the explicit stop() the interval
      // would re-`terminate()` every tick.
      try {
        raw.terminate();
      } catch {
        /* ignore — we stop the loop regardless */
      }
      stop();
      return;
    }
    try {
      raw.ping();
    } catch {
      /* socket mid-close — next tick's readyState guard self-cleans */
    }
  }, intervalMs);
  // Never keep the event loop alive solely for the heartbeat.
  (timer as { unref?: () => void }).unref?.();

  return stop;
}
