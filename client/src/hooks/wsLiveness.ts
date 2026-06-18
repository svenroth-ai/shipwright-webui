/*
 * wsLiveness — cohesive WS liveness controller for the embedded terminal
 * (iterate-2026-06-18-terminal-ws-reconnect-refocus).
 *
 * Owns BOTH halves of "is this socket actually alive, and revive it if not":
 *   1. a per-connection ping/pong heartbeat (startClientHeartbeat), and
 *   2. a reconnect-on-refocus handler bound to window focus/pageshow +
 *      document visibilitychange.
 *
 * The repaint-on-focus effect in `useTerminalResize` only redraws the existing
 * buffer — it cannot revive a socket that died silently while the tab was
 * backgrounded (OS sleep / Tailscale partition never fires `close`). This
 * controller is what actually reconnects. `useTerminalSocket` wires it via the
 * deps below and drives it with onConnected / onDisconnected / noteInbound /
 * dispose.
 */

import {
  startClientHeartbeat,
  WS_REFOCUS_PROBE_MS,
  type ClientHeartbeatHandle,
  type HeartbeatTimer,
} from "./wsHeartbeat";

/** Structural slice of a WebSocket the liveness controller depends on. */
export interface WsLivenessSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
}

export interface AttachWsLivenessDeps {
  /** Current socket, or null while disconnected. */
  getSocket(): WsLivenessSocket | null;
  /** Numeric OPEN readyState (`WebSocket.OPEN`). */
  openState: number;
  /** True once this attach is a done/replay-only session — never revive it. */
  isReplayOnly(): boolean;
  /** True once the owning effect was torn down / superseded. */
  isCancelled(): boolean;
  /** Re-arm the reconnect budget (attempts → 0). */
  rearmBudget(): void;
  /** Reconnect now: drop any pending backoff, open a fresh socket. */
  reconnect(): void;
  // Seams (tests / tuning).
  intervalMs?: number;
  maxMissed?: number;
  refocusProbeMs?: number;
  setIntervalFn?: (handler: () => void, ms: number) => HeartbeatTimer;
  clearIntervalFn?: (timer: HeartbeatTimer) => void;
  setTimeoutFn?: (handler: () => void, ms: number) => HeartbeatTimer;
  clearTimeoutFn?: (timer: HeartbeatTimer) => void;
}

export interface WsLivenessController {
  /** Call on socket OPEN — (re)start the per-connection heartbeat. */
  onConnected(): void;
  /** Call on socket CLOSE (or when the session becomes replay-only) — stop it. */
  onDisconnected(): void;
  /** Call on ANY inbound message — reset liveness + satisfy a pending probe. */
  noteInbound(): void;
  /** Remove window/document listeners + timers (effect teardown). */
  dispose(): void;
}

/**
 * Wire WS liveness for one mount. Window/document listeners are registered
 * immediately and removed by `dispose()`.
 */
export function attachWsLiveness(
  deps: AttachWsLivenessDeps,
): WsLivenessController {
  const refocusProbeMs = deps.refocusProbeMs ?? WS_REFOCUS_PROBE_MS;
  const setT: (handler: () => void, ms: number) => HeartbeatTimer =
    deps.setTimeoutFn ??
    (setTimeout as unknown as (handler: () => void, ms: number) => HeartbeatTimer);
  const clearT: (timer: HeartbeatTimer) => void =
    deps.clearTimeoutFn ??
    (clearTimeout as unknown as (timer: HeartbeatTimer) => void);

  let heartbeat: ClientHeartbeatHandle | null = null;
  let probeTimer: HeartbeatTimer | null = null;
  let awaitingProbe = false;

  const sendPing = () => {
    const s = deps.getSocket();
    if (!s) return;
    try {
      s.send(JSON.stringify({ type: "ping" }));
    } catch {
      /* socket mid-close */
    }
  };
  const clearProbe = () => {
    awaitingProbe = false;
    if (probeTimer !== null) {
      clearT(probeTimer);
      probeTimer = null;
    }
  };

  const onConnected = () => {
    // A fresh connection makes any probe armed for the PRIOR socket moot —
    // drop it so a stale timer can never act on this new socket (review MED).
    clearProbe();
    heartbeat?.stop();
    heartbeat = startClientHeartbeat({
      isOpen: () => deps.getSocket()?.readyState === deps.openState,
      sendPing,
      onDead: () => {
        const s = deps.getSocket();
        if (s) {
          try {
            s.close();
          } catch {
            /* ignore */
          }
        }
      },
      intervalMs: deps.intervalMs,
      maxMissed: deps.maxMissed,
      setIntervalFn: deps.setIntervalFn,
      clearIntervalFn: deps.clearIntervalFn,
    });
  };
  const onDisconnected = () => {
    heartbeat?.stop();
    heartbeat = null;
  };
  const noteInbound = () => {
    heartbeat?.notePong();
    clearProbe();
  };

  const onRefocus = () => {
    if (deps.isCancelled()) return;
    // Filters the HIDE half of the shared `visibilitychange` listener; `focus`
    // and `pageshow` only ever fire on becoming-visible, so this is a no-op
    // for them.
    if (typeof document !== "undefined" && document.hidden) return;
    if (deps.isReplayOnly()) return;
    // Returning to the tab re-arms the ~6s reconnect budget that may have been
    // spent (and failed) while backgrounded across a sleep/Tailscale partition.
    deps.rearmBudget();
    const s = deps.getSocket();
    if (!s) {
      // No live/in-flight socket (budget exhausted, or between attempts —
      // `socketRef` is nulled on close). Reconnect now.
      deps.reconnect();
      return;
    }
    if (s.readyState !== deps.openState) {
      // CONNECTING: a fresh attempt is already in flight — calling connect()
      // again would orphan it and risk a double server attach (external
      // review gemini HIGH). CLOSING: the close handler will reconnect with
      // the budget we just re-armed. Either way, leave the existing attempt.
      return;
    }
    // Socket LOOKS open but a full partition leaves it silently dead with no
    // `close` event. Probe: ping now, and if nothing answers within
    // refocusProbeMs, close it so the close → reconnect path runs.
    sendPing();
    awaitingProbe = true;
    // Bind the probe to THIS socket instance: a reconnect may swap in a fresh,
    // healthy socket within the probe window, and a timer armed for the old
    // socket must never close the new one (review MED).
    const probedSocket = s;
    if (probeTimer !== null) clearT(probeTimer);
    probeTimer = setT(() => {
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
    }, refocusProbeMs);
  };

  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";
  if (hasWindow) {
    window.addEventListener("focus", onRefocus);
    window.addEventListener("pageshow", onRefocus);
  }
  if (hasDocument) {
    document.addEventListener("visibilitychange", onRefocus);
  }

  return {
    onConnected,
    onDisconnected,
    noteInbound,
    dispose() {
      onDisconnected();
      clearProbe();
      if (hasWindow) {
        window.removeEventListener("focus", onRefocus);
        window.removeEventListener("pageshow", onRefocus);
      }
      if (hasDocument) {
        document.removeEventListener("visibilitychange", onRefocus);
      }
    },
  };
}
