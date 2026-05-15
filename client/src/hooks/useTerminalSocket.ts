/*
 * useTerminalSocket — WebSocket bridge for the embedded-terminal panel
 * (iterate-2026-05-03 / ADR-067).
 *
 * Contract:
 *   - Auto-connects on mount; auto-reconnects with exp-backoff (max 5).
 *   - Protocol inferred from window.location.protocol (ws:// vs wss://).
 *   - Inbound JSON envelope:  {type:"ready",role,shellKind,cwd}
 *                              {type:"data",payload}
 *                              {type:"backpressure",droppedBytes}
 *                              {type:"read_only"}
 *                              {type:"replay_snapshot",data,cols,rows,terminalVersion} [ADR-087/089]
 *                              {type:"scrollback-meta",scrollbackBytes}
 *                              {type:"writer-promoted"} | {type:"second-attach"}
 *   - Outbound JSON envelope: {type:"data",payload}  | {type:"resize",cols,rows}
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

export type TerminalRole = "writer" | "reader";

export interface TerminalReadyInfo {
  role: TerminalRole;
  shellKind: "pwsh" | "cmd" | "posix";
  cwd: string;
  /**
   * Iterate v0.8.2 AC-7 — server bypassed pty spawn because the task is
   * in a terminal state (`done` / `launch_failed`). UI should render a
   * "Session ended" banner instead of an input cursor; the server will
   * close the WS after the replay envelopes.
   */
  replayOnly: boolean;
  /**
   * Iterate v0.8.2 AC-8 — total persisted scrollback bytes for this
   * task. 0 when the store is disabled or the task has never written
   * scrollback. Disclosure footer renders only when > 0.
   */
  scrollbackBytes: number;
  /**
   * Iterate v0.8.2 AC-9 — retention TTL surfaced for the disclosure
   * footer copy.
   */
  retentionDays: number;
  /**
   * Iterate v0.8.2 AC-9 — resolved scrollback dir for the disclosure
   * footer copy.
   */
  scrollbackDir: string;
}

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
  /** Last error message, if any. */
  lastError: string | null;
  /** Number of reconnect attempts since last successful connect. */
  reconnectAttempts: number;
  /** Send a typed envelope. No-op if socket is not OPEN. */
  send: (msg: { type: "data"; payload: string } | { type: "resize"; cols: number; rows: number }) => void;
  /** True while socket.readyState === OPEN. */
  open: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_MS = [200, 400, 800, 1600, 3200];

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
  const [open, setOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);

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
      setReady(false);
      setRole(null);
      setShellKind(null);
      setReplayOnly(null);
      setScrollbackBytes(null);
      setRetentionDays(null);
      setScrollbackDir(null);
      setTerminalReset(null);
      setOpen(false);
      return;
    }
    // Per-effect-instance cancelled flag (NOT a shared useRef). Each
    // mount of the effect captures its own `cancelled` in its closures
    // — so a stale close-handler from a previously-unmounted effect
    // can NOT see `cancelled === false` after another mount reset
    // a shared ref. Closes the React.StrictMode triple-WS bug where
    // mount-1's ws_A close fired AFTER mount-2's effect, then
    // mount-1's scheduleReconnect created a spurious ws_C overwriting
    // mount-2's ws_B in socketRef.
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
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

      ws.addEventListener("open", () => {
        if (cancelled) return;
        setOpen(true);
        attemptsRef.current = 0;
        setReconnectAttempts(0);
        setLastError(null);
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
        if (env.type === "ready") {
          if (env.role === "writer" || env.role === "reader") setRole(env.role);
          if (env.shellKind === "pwsh" || env.shellKind === "cmd" || env.shellKind === "posix") {
            setShellKind(env.shellKind);
          }
          // Iterate v0.8.2 AC-7/8/9 — defensive parse for the new ready
          // envelope fields. `replayOnly` defaults to false to match the
          // pre-v0.8.2 server behavior; the bytes/retention fields stay
          // null when absent so the page layer can opt-out cleanly.
          setReplayOnly(typeof env.replayOnly === "boolean" ? env.replayOnly : false);
          setScrollbackBytes(
            typeof env.scrollbackBytes === "number" && env.scrollbackBytes >= 0
              ? env.scrollbackBytes
              : null,
          );
          setRetentionDays(
            typeof env.retentionDays === "number" && env.retentionDays > 0
              ? env.retentionDays
              : null,
          );
          setScrollbackDir(
            typeof env.scrollbackDir === "string" && env.scrollbackDir.length > 0
              ? env.scrollbackDir
              : null,
          );
          // ADR-104 — reset-banner signal. Defaults to false when an
          // older server omits the field (back-compat).
          setTerminalReset(
            typeof env.terminalReset === "boolean" ? env.terminalReset : false,
          );
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
      ws.addEventListener("close", () => {
        // CRITICAL: bail out if this effect-instance was cleaned up.
        // Without this, a stale handler from a previously-unmounted
        // effect would still drive socketRef + scheduleReconnect.
        if (cancelled) return;
        setOpen(false);
        setReady(false);
        socketRef.current = null;
        scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        if (cancelled) return;
        setLastError("websocket error");
      });
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      const delay = BACKOFF_MS[Math.min(attemptsRef.current, BACKOFF_MS.length - 1)];
      attemptsRef.current += 1;
      setReconnectAttempts(attemptsRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) connect();
      }, delay);
    };

    connect();

    return () => {
      cancelled = true;
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
      setReady(false);
      setRole(null);
      setShellKind(null);
      setReplayOnly(null);
      setScrollbackBytes(null);
      setRetentionDays(null);
      setScrollbackDir(null);
      setTerminalReset(null);
      setOpen(false);
    };
  }, [enabled, taskId, urlOverride]);

  return {
    ready,
    role,
    shellKind,
    replayOnly,
    scrollbackBytes,
    retentionDays,
    scrollbackDir,
    terminalReset,
    lastError,
    reconnectAttempts,
    send,
    open,
  };
}
