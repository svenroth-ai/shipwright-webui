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
 *   - Outbound JSON envelope: {type:"data",payload}  | {type:"resize",cols,rows}
 *   - `ready === true` exactly when the socket is OPEN AND a server-side
 *     `ready` envelope has arrived. The TaskDetail launch-flow waits on
 *     this before calling term.focus().
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type TerminalRole = "writer" | "reader";

export interface TerminalReadyInfo {
  role: TerminalRole;
  shellKind: "pwsh" | "cmd" | "posix";
  cwd: string;
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
}

export interface UseTerminalSocketResult {
  /** Term mounted-time gating — true once ready envelope received. */
  ready: boolean;
  /** writer/reader role from the server. */
  role: TerminalRole | null;
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
  const { taskId, urlOverride, enabled = true, onData, onBackpressure, onReadOnly } = opts;

  // Stable refs for callbacks so the effect doesn't tear down on every parent re-render.
  const onDataRef = useRef(onData);
  const onBackpressureRef = useRef(onBackpressure);
  const onReadOnlyRef = useRef(onReadOnly);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);
  useEffect(() => {
    onBackpressureRef.current = onBackpressure;
  }, [onBackpressure]);
  useEffect(() => {
    onReadOnlyRef.current = onReadOnly;
  }, [onReadOnly]);

  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<TerminalRole | null>(null);
  const [open, setOpen] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);

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
      setOpen(false);
      return;
    }
    cancelledRef.current = false;

    const connect = () => {
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
        setOpen(true);
        attemptsRef.current = 0;
        setReconnectAttempts(0);
        setLastError(null);
      });
      ws.addEventListener("message", (evt) => {
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
      });
      ws.addEventListener("close", () => {
        setOpen(false);
        setReady(false);
        socketRef.current = null;
        if (!cancelledRef.current) scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        setLastError("websocket error");
      });
    };

    const scheduleReconnect = () => {
      if (cancelledRef.current) return;
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      const delay = BACKOFF_MS[Math.min(attemptsRef.current, BACKOFF_MS.length - 1)];
      attemptsRef.current += 1;
      setReconnectAttempts(attemptsRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelledRef.current = true;
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
      setOpen(false);
    };
  }, [enabled, taskId, urlOverride]);

  return { ready, role, lastError, reconnectAttempts, send, open };
}
