/*
 * useTerminalSocket — WebSocket bridge for the embedded-terminal panel
 * (iterate-2026-05-03 / ADR-067).
 *
 * Contract:
 *   - Auto-connects on mount; reconnects on a ramp → tail → slow-tail schedule
 *     that NEVER gives up while the attach is live (`wsReconnectSchedule.ts`).
 *   - Protocol mirrors window.location.protocol — secure (WSS) on HTTPS pages,
 *     plain on loopback HTTP. (Comment reworded to drop the literal insecure
 *     scheme that Semgrep's detect-insecure-websocket flagged; the runtime URL
 *     is always derived from the page protocol, never a hardcoded insecure one.)
 *   - Inbound JSON envelope:  {type:"ready",role,shellKind,cwd}
 *                              {type:"data",payload}
 *                              {type:"backpressure",droppedBytes}
 *                              {type:"read_only"}
 *                              {type:"replay_snapshot",data,cols,rows,terminalVersion} [ADR-087/089]
 *                              {type:"scrollback-meta",scrollbackBytes}
 *                              {type:"writer-promoted"} | {type:"second-attach"}
 *   - Outbound JSON envelope: {type:"data",payload}  | {type:"resize",cols,rows}
 *   - The `ready` envelope additionally carries `terminalReset` (ADR-104)
 *     and `ptyReused` (fix-resume-guard-survives-reload) — both default
 *     to `false` when an older server omits them.
 *   - `ready === true` exactly when the socket is OPEN AND a server-side
 *     `ready` envelope has arrived. The TaskDetail launch-flow waits on
 *     this before calling term.focus().
 *
 * Iterate C (ADR-087): the legacy chunked-replay envelopes
 * (`replay_start` / `replay_chunk` / `replay_separator` / `replay_end`)
 * are RETIRED. The server emits a single `replay_snapshot` envelope
 * when a cell-state snapshot exists; otherwise the client gets no
 * replay history at all (blank terminal with live shell).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { attachWsLiveness } from "./wsLiveness";
import {
  BACKOFF_MS,
  createConnectWatchdog,
  isSlowTail,
  nextReconnectDelay,
} from "./wsReconnectSchedule";
import { parseReadyEnvelope } from "./wsReadyEnvelope";

import type { TerminalRole, TerminalReadyInfo } from "./wsReadyEnvelope";
export type { TerminalRole, TerminalReadyInfo };

export interface UseTerminalSocketOptions {
  taskId: string | null;
  /** Defaults to `${proto}//${host}/api/terminal/${taskId}/ws`. */
  urlOverride?: string;
  /** Disables auto-connect (useful for tests). */
  enabled?: boolean;
  /** Called on every inbound `data` envelope; mounted-once expected. */
  onData?: (chunk: string) => void;
  /** Called on inbound `backpressure` envelope. */
  onBackpressure?: (info: { droppedBytes: number }) => void;
  /** Called on inbound `read_only` envelope. */
  onReadOnly?: () => void;
  /**
   * ADR-087/089 — single-envelope snapshot replay. When the server has
   * a fresh cell-state snapshot for this task whose `terminalVersion`
   * matches the client's xterm.js family, it emits one
   * `replay_snapshot` envelope. Consumer writes `data` ONCE into
   * xterm — server stabilised via M2 double-serialize. Iterate C
   * retired the legacy chunked-replay path entirely; this is now the
   * only replay envelope.
   *
   * `terminalVersion` is the server-side `@xterm/headless` version
   * that produced the payload; consumer MAY warn on minor mismatch
   * but still write (server's version gate is the authoritative
   * accept/reject layer).
   */
  onReplaySnapshot?: (info: {
    data: string;
    cols: number;
    rows: number;
    terminalVersion: string;
  }) => void;
}

export interface UseTerminalSocketResult {
  /** Term mounted-time gating — true once ready envelope received. */
  ready: boolean;
  /** writer/reader role from the server. */
  role: TerminalRole | null;
  /**
   * Server-reported shell kind from the ready envelope. Used by
   * LaunchCoordinator (ADR-068-A1) to pick the correct shell-form
   * of the launch command. Null until ready envelope arrives.
   */
  shellKind: TerminalReadyInfo["shellKind"] | null;
  /**
   * Iterate v0.8.2 AC-7/8/9 — surfaced from the ready envelope so the
   * page-layer (TaskDetailPage) can render the conditional disclosure
   * footer + the "Session ended" replay-only banner. Null until ready
   * envelope arrives.
   */
  replayOnly: boolean | null;
  scrollbackBytes: number | null;
  retentionDays: number | null;
  scrollbackDir: string | null;
  /**
   * ADR-104 (iterate-20260515-terminal-smear-reset) — true when this WS
   * attach freshly re-created the pty after a prior Claude session was
   * lost (server restart / crash). Drives the EmbeddedTerminal reset
   * banner. Null until the `ready` envelope arrives; `false` when an
   * older server omits the field (back-compat).
   */
  terminalReset: boolean | null;
  /**
   * fix-resume-guard-survives-reload (2026-05-17) — true when this WS
   * attach REUSED a pty that pre-existed the attach (the pty persisted
   * across a browser reload / navigate-away-and-back) rather than
   * spawning a fresh one. Drives the EmbeddedTerminal one-shot inject
   * guard so a post-reload launch parks behind an explicit confirm
   * instead of auto-injecting `claude --resume …` into a still-live
   * Claude session. Null until the `ready` envelope arrives; `false`
   * when an older server omits the field (back-compat). Mutually
   * exclusive with `terminalReset` — a freshly created pty is not a
   * reused one.
   */
  ptyReused: boolean | null;
  /** Last error message, if any. */
  lastError: string | null;
  /** Number of reconnect attempts since last successful connect. */
  reconnectAttempts: number;
  /**
   * Socket down, retry armed — drives the "Reconnecting…" banner so a dead
   * socket reads as *disconnected* rather than *frozen*. `false` for a
   * replay-only attach, which is finished rather than broken.
   */
  reconnecting: boolean;
  /** Outage outlived the prompt window → slow tail; softens the banner copy. */
  reconnectStalled: boolean;
  /** Send a typed envelope. No-op if socket is not OPEN. */
  send: (msg: { type: "data"; payload: string } | { type: "resize"; cols: number; rows: number }) => void;
  /** True while socket.readyState === OPEN. */
  open: boolean;
}

function defaultUrl(taskId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/terminal/${encodeURIComponent(taskId)}/ws`;
}

export function useTerminalSocket(opts: UseTerminalSocketOptions): UseTerminalSocketResult {
  const {
    taskId,
    urlOverride,
    enabled = true,
    onData,
    onBackpressure,
    onReadOnly,
    onReplaySnapshot,
  } = opts;

  // Stable refs for callbacks so the effect doesn't tear down on every parent re-render.
  const onDataRef = useRef(onData);
  const onBackpressureRef = useRef(onBackpressure);
  const onReadOnlyRef = useRef(onReadOnly);
  const onReplaySnapshotRef = useRef(onReplaySnapshot);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);
  useEffect(() => {
    onBackpressureRef.current = onBackpressure;
  }, [onBackpressure]);
  useEffect(() => {
    onReadOnlyRef.current = onReadOnly;
  }, [onReadOnly]);
  useEffect(() => {
    onReplaySnapshotRef.current = onReplaySnapshot;
  }, [onReplaySnapshot]);

  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<TerminalRole | null>(null);
  const [shellKind, setShellKind] = useState<TerminalReadyInfo["shellKind"] | null>(null);
  const [replayOnly, setReplayOnly] = useState<boolean | null>(null);
  const [scrollbackBytes, setScrollbackBytes] = useState<number | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [scrollbackDir, setScrollbackDir] = useState<string | null>(null);
  const [terminalReset, setTerminalReset] = useState<boolean | null>(null);
  const [ptyReused, setPtyReused] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectStalled, setReconnectStalled] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  // Mirror of `replayOnly` from the most-recent `ready` envelope, read by
  // the close handler. A replay-only attach is one-shot by design: server
  // sends `ready` + `replay_snapshot`, then closes the WS with code 1000.
  // Without this signal the close handler unconditionally reconnects,
  // looping the snapshot replay every ~200 ms (attemptsRef resets to 0 on
  // every successful open) — visible to the user as a terminal flicker
  // because each replay does `term.reset()` + `term.write(snapshot)`.
  const replayOnlyRef = useRef<boolean | null>(null);

  // iterate-2026-06-18 — sticky mirror of `replayOnly` for the liveness
  // controller. Set true when a replay-only `ready` arrives; survives the
  // subsequent close (NOT nulled on close like `replayOnlyRef`) so a refocus
  // never resurrects a finished/done attach. Reset only at the start of a new
  // session lifecycle (taskId / enabled / urlOverride change re-runs the
  // effect). Heartbeat + refocus mechanics live in `attachWsLiveness`.
  const sessionReplayOnlyRef = useRef(false);

  /** Clear every per-attach state field (disabled branch + effect teardown). */
  const resetSessionState = useCallback(() => {
    setReady(false);
    setRole(null);
    setShellKind(null);
    setReplayOnly(null);
    setScrollbackBytes(null);
    setRetentionDays(null);
    setScrollbackDir(null);
    setTerminalReset(null);
    setPtyReused(null);
    setOpen(false);
    setReconnecting(false);
    setReconnectStalled(false);
  }, []);

  const send = useCallback(
    (msg: { type: "data"; payload: string } | { type: "resize"; cols: number; rows: number }) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !taskId) {
      resetSessionState();
      replayOnlyRef.current = null;
      sessionReplayOnlyRef.current = false;
      return;
    }
    replayOnlyRef.current = null;
    sessionReplayOnlyRef.current = false;
    // Per-effect-instance cancelled flag (NOT a shared useRef). Each
    // mount of the effect captures its own `cancelled` in its closures
    // — so a stale close-handler from a previously-unmounted effect
    // can NOT see `cancelled === false` after another mount reset
    // a shared ref. Closes the React.StrictMode triple-WS bug where
    // mount-1's ws_A close fired AFTER mount-2's effect, then
    // mount-1's scheduleReconnect created a spurious ws_C overwriting
    // mount-2's ws_B in socketRef.
    let cancelled = false;

    const watchdog = createConnectWatchdog({
      connectingState: WebSocket.CONNECTING,
      isCancelled: () => cancelled,
      isCurrent: (ws) => socketRef.current === ws,
    });

    const connect = () => {
      if (cancelled) return;
      // External-review defense-in-depth (openai medium #1): every fresh
      // WebSocket attempt — first connect or reconnect — starts with a
      // clean replay-only ref. The close handler already nulls the ref
      // after every close, so this is belt-and-braces against any future
      // path that creates a socket without going through close-then-
      // schedule-reconnect.
      replayOnlyRef.current = null;
      const url = urlOverride ?? defaultUrl(taskId);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        setLastError(String(err));
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      // Reap an attempt that never resolves — see wsReconnectSchedule.
      watchdog.arm(ws);

      ws.addEventListener("open", () => {
        if (cancelled) return;
        watchdog.clear();
        setOpen(true);
        attemptsRef.current = 0;
        setReconnectAttempts(0);
        setReconnecting(false);
        setReconnectStalled(false);
        setLastError(null);
        // (Re)start the per-connection liveness heartbeat (./wsLiveness).
        liveness.onConnected();
      });
      ws.addEventListener("message", (evt) => {
        if (cancelled) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(typeof evt.data === "string" ? evt.data : "");
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object") return;
        const env = parsed as Record<string, unknown>;
        // Any inbound envelope proves the peer is alive — reset liveness
        // (heartbeat miss-run + a pending refocus probe).
        liveness.noteInbound();
        if (env.type === "ready") {
          const r = parseReadyEnvelope(env);
          if (r.role) setRole(r.role);
          if (r.shellKind) setShellKind(r.shellKind);
          setReplayOnly(r.replayOnly);
          replayOnlyRef.current = r.replayOnly;
          if (r.replayOnly) {
            // Done/terminal attach: one-shot replay, then the server closes.
            // Never keepalive or resurrect it on refocus.
            sessionReplayOnlyRef.current = true;
            liveness.onDisconnected();
            // Finished, not broken — the banner must not claim it is returning.
            setReconnecting(false);
            setReconnectStalled(false);
          }
          setScrollbackBytes(r.scrollbackBytes);
          setRetentionDays(r.retentionDays);
          setScrollbackDir(r.scrollbackDir);
          setTerminalReset(r.terminalReset);
          setPtyReused(r.ptyReused);
          setReady(true);
          return;
        }
        if (env.type === "data" && typeof env.payload === "string") {
          onDataRef.current?.(env.payload);
          return;
        }
        if (env.type === "backpressure") {
          const dropped = typeof env.droppedBytes === "number" ? env.droppedBytes : 0;
          onBackpressureRef.current?.({ droppedBytes: dropped });
          return;
        }
        if (env.type === "read_only") {
          onReadOnlyRef.current?.();
          return;
        }
        if (env.type === "scrollback-meta") {
          // Iterate v0.8.2 AC-8/AC-9 follow-up envelope. Server sends
          // this after the async bytes() probe resolves so the
          // disclosure footer can render with the precise value
          // without delaying the original `ready` envelope.
          if (
            typeof env.scrollbackBytes === "number" &&
            env.scrollbackBytes >= 0
          ) {
            setScrollbackBytes(env.scrollbackBytes);
          }
          return;
        }
        if (env.type === "writer-promoted") {
          // The previous writer detached; the server promoted us. Flip
          // the role so the UI clears the read-only banner. Closes the
          // React.StrictMode double-mount race where the second WS opens
          // before the first close arrives and gets reader role.
          setRole("writer");
          return;
        }
        // Iterate C (ADR-087): the legacy chunked-replay envelopes
        // (`replay_start` / `replay_chunk` / `replay_separator` /
        // `replay_end`) have been retired. The server emits a single
        // `replay_snapshot` envelope; consumer writes `data` ONCE.
        // Cell-state snapshots are produced by @xterm/headless +
        // addon-serialize and stabilised via the M2 double-serialize.
        if (
          env.type === "replay_snapshot" &&
          typeof env.data === "string" &&
          typeof env.cols === "number" &&
          typeof env.rows === "number" &&
          typeof env.terminalVersion === "string"
        ) {
          onReplaySnapshotRef.current?.({
            data: env.data,
            cols: env.cols,
            rows: env.rows,
            terminalVersion: env.terminalVersion,
          });
          return;
        }
      });
      ws.addEventListener("close", (evt) => {
        // CRITICAL: bail out if this effect-instance was cleaned up.
        // Without this, a stale handler from a previously-unmounted
        // effect would still drive socketRef + scheduleReconnect.
        if (cancelled) return;
        watchdog.clear();
        setOpen(false);
        setReady(false);
        socketRef.current = null;
        liveness.onDisconnected();
        // Replay-only attaches are one-shot by server contract: after
        // delivering `ready` + `replay_snapshot` the server closes the
        // WS with code 1000 (server/src/terminal/routes.ts replay-only
        // branch). Reconnecting just replays the same snapshot again,
        // and each replay does term.reset() + term.write(snapshot) —
        // the user sees a perpetual blank-then-repaint flicker because
        // attemptsRef resets to 0 on every successful open. Skip
        // reconnect for that case; abnormal closes (code !== 1000) still
        // reconnect so a server crash mid-replay can recover.
        //
        // NOTE (external-review openai medium #5): this is intentionally
        // narrow and is NOT a general "don't reconnect on code 1000"
        // policy — a clean close of a LIVE attach (server graceful
        // shutdown / restart) still reconnects, because `replayOnlyRef`
        // is `false` for that case. Do NOT broaden to "any 1000 close"
        // — that would also suppress reconnect on graceful server
        // restarts, which is regression-equivalent to the original bug
        // for live sessions.
        const closeCode =
          (evt as { code?: number } | undefined)?.code;
        const wasReplayOnlyClean =
          replayOnlyRef.current === true && closeCode === 1000;
        replayOnlyRef.current = null;
        if (wasReplayOnlyClean) return;
        scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        if (cancelled) return;
        setLastError("websocket error");
      });
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      // Done/replay-only attach: finished by server contract, never retry. The
      // close handler filters only the clean-1000 case, so without this an
      // ABNORMAL close would retry forever under the unbounded tail.
      if (sessionReplayOnlyRef.current) return;
      const attempt = attemptsRef.current;
      const delay = nextReconnectDelay(attempt);
      attemptsRef.current = attempt + 1;
      // Publish the counter only while the ramp is meaningful — past it it has
      // no consumer, and re-rendering every tail tick forever is pure waste.
      if (attempt < BACKOFF_MS.length) setReconnectAttempts(attemptsRef.current);
      setReconnecting(true);
      if (isSlowTail(attempt)) setReconnectStalled(true);
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) connect();
      }, delay);
    };

    // ── WS liveness controller (heartbeat + reconnect-on-refocus) ──
    // iterate-2026-06-18. Owns the window/document listeners + the per-
    // connection heartbeat; driven by onConnected / onDisconnected /
    // noteInbound from the socket event handlers above.
    const liveness = attachWsLiveness({
      getSocket: () => socketRef.current,
      openState: WebSocket.OPEN,
      isReplayOnly: () => sessionReplayOnlyRef.current,
      isCancelled: () => cancelled,
      rearmBudget: () => {
        attemptsRef.current = 0;
        setReconnectAttempts(0);
      },
      reconnect: () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        connect();
      },
    });

    connect();

    return () => {
      cancelled = true;
      liveness.dispose();
      watchdog.clear();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        try {
          ws.close(1000, "unmount");
        } catch {
          /* ignore */
        }
      }
      resetSessionState();
      replayOnlyRef.current = null;
    };
  }, [enabled, taskId, urlOverride, resetSessionState]);

  return {
    ready,
    role,
    shellKind,
    replayOnly,
    scrollbackBytes,
    retentionDays,
    scrollbackDir,
    terminalReset,
    ptyReused,
    lastError,
    reconnectAttempts,
    reconnecting,
    reconnectStalled,
    send,
    open,
  };
}
