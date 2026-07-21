/*
 * wsReconnectSchedule — reconnect timing policy + stuck-attempt watchdog for the
 * embedded-terminal socket (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * Extracted from `useTerminalSocket.ts` so the policy is a pure, directly
 * unit-testable function instead of being reachable only through the whole hook
 * (and to keep the hook under its anti-ratchet ceiling). ZERO React imports.
 *
 * The policy exists because the old schedule was a hard 5-attempt CAP. After an
 * OS sleep/resume the refocus probe reaps the half-open socket and the whole
 * budget is spent inside ~6.2 s — but a tunnelled network (Tailscale) can need
 * appreciably longer than that to become routable again. Every attempt then
 * failed against a network that could not answer yet, the cap was reached, and
 * the scheduler retired permanently while the per-connection heartbeat was
 * already stopped: ZERO armed timers, so nothing could observe the network
 * coming back. The terminal stayed frozen until the tab was reloaded.
 */

import {
  WS_CONNECT_TIMEOUT_MS,
  WS_RECONNECT_TAIL_MS,
  WS_RECONNECT_TAIL_SLOW_MS,
  WS_RECONNECT_TAIL_SLOW_AFTER,
} from "./wsHeartbeat";

/** Fast ramp for a transient blip — ~6.2 s in total. */
export const BACKOFF_MS = [200, 400, 800, 1600, 3200];

/**
 * Delay before attempt number `attempt` (0-based, counting from the last
 * successful open).
 *
 * Three regimes, and the scheduler NEVER returns "stop":
 *   1. `attempt < BACKOFF_MS.length` — the fast ramp, for an ordinary blip.
 *   2. the next `WS_RECONNECT_TAIL_SLOW_AFTER` attempts — a calm 5 s tail, so a
 *      network that returns later than the ramp is picked up promptly.
 *   3. thereafter — a 30 s tail. Not every failure is transient: a task whose
 *      cwd was deleted, or a removed worktree, makes the server reject the WS
 *      upgrade *deterministically* and identically every time, and the client
 *      cannot tell that apart from a transient failure. Backing off keeps an
 *      unattended tab from doing realpath I/O and emitting a server warn every
 *      5 s all night, while still never going inert.
 */
export function nextReconnectDelay(attempt: number): number {
  if (attempt < BACKOFF_MS.length) return BACKOFF_MS[attempt];
  if (attempt < BACKOFF_MS.length + WS_RECONNECT_TAIL_SLOW_AFTER) {
    return WS_RECONNECT_TAIL_MS;
  }
  return WS_RECONNECT_TAIL_SLOW_MS;
}

/** True once `attempt` has fallen back to the slow tail (drives banner copy). */
export function isSlowTail(attempt: number): boolean {
  return attempt >= BACKOFF_MS.length + WS_RECONNECT_TAIL_SLOW_AFTER;
}

/** Structural slice of a WebSocket the watchdog needs. */
export interface WatchdogSocket {
  readyState: number;
  close(): void;
}

export interface ConnectWatchdog {
  /** Arm for one attempt. Replaces any previously armed attempt. */
  arm(ws: WatchdogSocket): void;
  /** Idempotent cancel (call on open, on close, and on teardown). */
  clear(): void;
}

/**
 * Reap a connect attempt that never resolves.
 *
 * The retry tail is driven by the `close` event: a failed attempt schedules the
 * next one. But a socket can sit in `CONNECTING` indefinitely — a SYN into a
 * blackholed route is exactly what a half-restored tunnel produces after a
 * resume, and the browser's own connect timeout is minutes long. No `close`
 * would fire, so no retry would be scheduled and the client would be right back
 * in the inert state this iterate removes (found by external code review).
 * Closing a stuck attempt fires `close`, re-entering the normal retry path.
 */
export function createConnectWatchdog(deps: {
  connectingState: number;
  isCancelled(): boolean;
  /** True while `ws` is still the attempt the caller cares about. */
  isCurrent(ws: WatchdogSocket): boolean;
  timeoutMs?: number;
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}): ConnectWatchdog {
  const timeoutMs = deps.timeoutMs ?? WS_CONNECT_TIMEOUT_MS;
  const setT: (handler: () => void, ms: number) => ReturnType<typeof setTimeout> =
    deps.setTimeoutFn ??
    (setTimeout as unknown as (handler: () => void, ms: number) => ReturnType<typeof setTimeout>);
  const clearT: (timer: ReturnType<typeof setTimeout>) => void =
    deps.clearTimeoutFn ??
    (clearTimeout as unknown as (timer: ReturnType<typeof setTimeout>) => void);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  };

  return {
    clear,
    arm(ws) {
      clear();
      timer = setT(() => {
        timer = null;
        if (deps.isCancelled()) return;
        // A newer socket may have superseded this attempt.
        if (!deps.isCurrent(ws)) return;
        if (ws.readyState !== deps.connectingState) return;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, timeoutMs);
    },
  };
}
