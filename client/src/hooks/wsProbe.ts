/*
 * wsProbe — eager liveness probe for a socket that LOOKS open but may be
 * silently dead (iterate-2026-06-18-terminal-ws-reconnect-refocus; split out
 * of wsLiveness.ts in iterate-2026-09-06-tablet-ipad-ux-pass to keep both
 * files under the bloat ceiling).
 *
 * Ping the peer, then — if nothing answers within `refocusProbeMs` — close
 * the socket so the caller's existing close -> reconnect path runs. Bound to
 * ONE socket instance: a reconnect that swaps in a fresh socket during the
 * probe window must never let a stale timer close it (review MED).
 */

import type { WsLivenessSocket } from "./wsLiveness";
import type { HeartbeatTimer } from "./wsHeartbeat";

export interface WsProbeDeps {
  getSocket(): WsLivenessSocket | null;
  openState: number;
  /** Send a ping frame on the current socket (shared with the heartbeat). */
  sendPing(): void;
  isCancelled(): boolean;
  /** true while the probe is in flight, false once it resolves — feeds a
   * `reconnecting` banner (AC-1, iterate-2026-09-06-tablet-ipad-ux-pass). */
  onProbing?: (probing: boolean) => void;
  refocusProbeMs: number;
  setTimeoutFn(handler: () => void, ms: number): HeartbeatTimer;
  clearTimeoutFn(timer: HeartbeatTimer): void;
}

export interface WsProbeController {
  /** True while a probe is outstanding. */
  isAwaiting(): boolean;
  /** Ping the current socket and arm the close-on-timeout probe. */
  arm(): void;
  /** Cancel any pending probe (answered by an inbound frame, or superseded). */
  clear(): void;
}

export function createWsProbe(deps: WsProbeDeps): WsProbeController {
  let awaitingProbe = false;
  let probeTimer: HeartbeatTimer | null = null;

  const clear = () => {
    if (awaitingProbe) deps.onProbing?.(false);
    awaitingProbe = false;
    if (probeTimer !== null) {
      deps.clearTimeoutFn(probeTimer);
      probeTimer = null;
    }
  };

  const arm = () => {
    const s = deps.getSocket();
    if (!s) return;
    deps.sendPing();
    awaitingProbe = true;
    deps.onProbing?.(true);
    // Bind the probe to THIS socket instance: a reconnect may swap in a
    // fresh, healthy socket within the probe window, and a timer armed for
    // the old socket must never close the new one (review MED).
    const probedSocket = s;
    if (probeTimer !== null) deps.clearTimeoutFn(probeTimer);
    probeTimer = deps.setTimeoutFn(() => {
      probeTimer = null;
      if (deps.isCancelled() || !awaitingProbe) return;
      const cur = deps.getSocket();
      if (cur === probedSocket && cur.readyState === deps.openState) {
        try {
          cur.close();
        } catch {
          /* ignore */
        }
      }
    }, deps.refocusProbeMs);
  };

  return { isAwaiting: () => awaitingProbe, arm, clear };
}
