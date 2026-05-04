/*
 * EmbeddedTerminal — xterm.js terminal panel hosted inside TaskDetailPage
 * (iterate-2026-05-03 / ADR-067).
 *
 * Plan-D''-conform: this is a NEUTRAL shell pane (pwsh / cmd / bash), not
 * a Claude runner. Claude execution stays user-initiated (Strg+V + Enter
 * after Auto-Copy on Launch — see TaskDetailPage launch-flow).
 *
 * Image-paste contract (ADR-067, AC-6 / AC-6a / AC-6b):
 *   - DOM `paste` listener with capture phase fires BEFORE xterm.
 *   - Image-wins precedence: any ClipboardItem with type starting "image/"
 *     is uploaded to /api/terminal/:taskId/paste-image (multipart). Server
 *     persists to <task.cwd>/.claude-pastes/img-<ts>-<rand>.png and
 *     pty.write()s the shell-quoted absolute path.
 *   - Text-only clipboard: preventDefault + socket.send({type:"data", payload}).
 *   - Mixed clipboard: image wins; text dropped intentionally.
 *
 * The component exposes an imperative ref (`focus()`, `ready`) so the
 * launch-flow side-effect in TaskDetailPage can wait for ready === true
 * before focusing — closes the race surfaced by external review F8.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import {
  useTerminalSocket,
  type TerminalRole,
} from "../../hooks/useTerminalSocket";

export interface EmbeddedTerminalHandle {
  focus(): void;
  ready: boolean;
}

export interface EmbeddedTerminalProps {
  taskId: string;
  /**
   * Visibility flag from the parent's tab strip. The component stays
   * MOUNTED across tab toggles (Radix `forceMount` on Tabs.Content per
   * external review F3) — this prop only controls whether `fit()` is
   * re-invoked, since hidden containers report 0×0 and break xterm sizing.
   */
  active: boolean;
  /** Override URL for tests; defaults to the live WS endpoint. */
  socketUrlOverride?: string;
  /** Disables auto-connect (for tests). */
  socketEnabled?: boolean;
  /** Surface gitignore-suggestion toast — wired by TaskDetailPage. */
  onGitignoreSuggestion?: () => void;
  /** Surface backpressure events — for diagnostics overlays. */
  onBackpressure?: (info: { droppedBytes: number }) => void;
  /** Surface readiness for the launch-flow handshake. */
  onReadyChange?: (ready: boolean, role: TerminalRole | null) => void;
  /**
   * Surface paste-image upload failures (network errors, server 4xx/5xx)
   * so the parent can show a toast instead of swallowing the failure.
   */
  onPasteImageError?: (detail: string) => void;
}

const RESIZE_THROTTLE_MS = 250;

export const EmbeddedTerminal = forwardRef<EmbeddedTerminalHandle, EmbeddedTerminalProps>(
  function EmbeddedTerminal(
    { taskId, active, socketUrlOverride, socketEnabled = true, onGitignoreSuggestion, onBackpressure, onReadyChange, onPasteImageError },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastResizeAtRef = useRef(0);
    const lastResizePendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const socket = useTerminalSocket({
      taskId,
      urlOverride: socketUrlOverride,
      enabled: socketEnabled,
      onData: (chunk) => {
        termRef.current?.write(chunk);
      },
      onBackpressure: (info) => {
        onBackpressure?.(info);
      },
    });

    // Derive the read-only state from socket.role — flipping cleanly
    // when the server promotes us via the writer-promoted envelope
    // (closes the StrictMode double-mount race; the previous local
    // setReadOnly(true) state never cleared on promotion).
    const readOnly = socket.role === "reader";

    // Surface ready for the launch-flow handshake.
    useEffect(() => {
      onReadyChange?.(socket.ready, socket.role);
    }, [socket.ready, socket.role, onReadyChange]);

    // Imperative API exposed to the parent.
    useImperativeHandle(
      ref,
      () => ({
        focus() {
          termRef.current?.focus();
        },
        get ready() {
          return socket.ready;
        },
      }),
      [socket.ready],
    );

    // Mount xterm + addons exactly once per component lifetime.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Bind xterm's theme to the project's brand palette. xterm's
      // default ANSI colors target a dark background — bright yellow
      // (#E5E510), bright cyan, etc. wash out on the warm beige
      // `--color-bg = #f5f0eb`. We pin ALL 16 ANSI slots to a
      // light-theme palette tuned for ~3:1+ contrast on beige and
      // mapped to brand semantic colors (warning=amber, error=red,
      // success=emerald) where the slot has a natural correspondence.
      const cssVar = (name: string, fallback: string) =>
        getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 13,
        theme: {
          background: cssVar("--color-bg", "#f5f0eb"),
          foreground: cssVar("--color-text", "#1a1a1a"),
          cursor: cssVar("--color-text", "#1a1a1a"),
          cursorAccent: cssVar("--color-bg", "#f5f0eb"),
          selectionBackground: cssVar("--color-primary", "#6b5e56") + "33",
          // Normal ANSI 0–7 — darker variants of the bright set so
          // bold/highlight stays distinguishable.
          black: "#1a1a1a",
          red: "#B91C1C",
          green: "#047857",
          yellow: "#B45309",     // amber-brown, NOT pure yellow
          blue: "#1D4ED8",
          magenta: "#7C3AED",
          cyan: "#0E7490",
          white: "#6b5e56",       // brand brown — "white" on beige is invisible
          // Bright ANSI 8–15 — pinned to brand semantic colors where possible.
          brightBlack: "#525252",
          brightRed: cssVar("--color-error", "#DC2626"),
          brightGreen: cssVar("--color-success", "#059669"),
          brightYellow: cssVar("--color-warning", "#D97706"),
          brightBlue: cssVar("--color-info", "#3B82F6"),
          brightMagenta: cssVar("--color-purple", "#8B5CF6"),
          brightCyan: "#0891B2",
          brightWhite: cssVar("--color-text", "#1a1a1a"),
        },
        scrollback: 5000,
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);
      term.open(container);
      try {
        fit.fit();
      } catch {
        /* container may not have non-zero size yet */
      }

      termRef.current = term;
      fitAddonRef.current = fit;

      // Forward keystrokes / paste-text into the socket.
      const onDataDispose = term.onData((data) => {
        socket.send({ type: "data", payload: data });
      });

      // ResizeObserver keeps xterm column count in sync with the container.
      const resizeAndSend = () => {
        try {
          fit.fit();
        } catch {
          return;
        }
        const cols = term.cols;
        const rows = term.rows;
        socket.send({ type: "resize", cols, rows });
      };
      const ro = new ResizeObserver(() => {
        const now = Date.now();
        if (now - lastResizeAtRef.current >= RESIZE_THROTTLE_MS) {
          lastResizeAtRef.current = now;
          resizeAndSend();
        } else if (!lastResizePendingRef.current) {
          lastResizePendingRef.current = setTimeout(() => {
            lastResizeAtRef.current = Date.now();
            lastResizePendingRef.current = null;
            resizeAndSend();
          }, RESIZE_THROTTLE_MS);
        }
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
        if (lastResizePendingRef.current) {
          clearTimeout(lastResizePendingRef.current);
          lastResizePendingRef.current = null;
        }
        onDataDispose.dispose();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
      // socket.send is stable via useCallback; we intentionally don't depend
      // on `socket` here because re-mounting xterm on every reconnect would
      // throw away scrollback. The send call uses the ref-routed websocket.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When the tab becomes active, re-fit (hidden containers report 0x0).
    useEffect(() => {
      if (!active) return;
      const fit = fitAddonRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      socket.send({ type: "resize", cols: term.cols, rows: term.rows });
    }, [active, socket]);

    // DOM paste handler (capture phase) — image-wins precedence per AC-6.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const handler = (ev: ClipboardEvent) => {
        const items = ev.clipboardData?.items;
        if (!items || items.length === 0) return;

        // Find first image item (image-wins precedence).
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === "file" && it.type.startsWith("image/")) {
            ev.preventDefault();
            ev.stopPropagation();
            const blob = it.getAsFile();
            if (!blob) return;
            const form = new FormData();
            form.append("image", blob, `paste-${Date.now()}.png`);
            const url = `/api/terminal/${encodeURIComponent(taskId)}/paste-image`;
            void fetch(url, { method: "POST", body: form })
              .then(async (res) => {
                if (!res.ok) {
                  // External review F-v2: surface paste-image failures
                  // instead of silently swallowing them. Reuse the
                  // backpressure callback path with a structured detail.
                  let detail = `HTTP ${res.status}`;
                  try {
                    const body = (await res.json().catch(() => null)) as
                      | { error?: string }
                      | null;
                    if (body?.error) detail = body.error;
                  } catch {
                    /* fall through */
                  }
                  onPasteImageError?.(detail);
                  return;
                }
                const body = (await res.json().catch(() => null)) as
                  | { gitignoreSuggestion?: boolean }
                  | null;
                if (body?.gitignoreSuggestion) {
                  onGitignoreSuggestion?.();
                }
              })
              .catch((err) => {
                onPasteImageError?.(err instanceof Error ? err.message : String(err));
              });
            return;
          }
        }

        // No image: fall through to text-paste via socket.send (AC-6a).
        // External review F-v2: detect text-item presence INDEPENDENT of
        // empty-string truthiness — empty paste should still preventDefault
        // for predictable single-path behavior.
        const hasTextItem = Array.from(items).some(
          (it) => it.kind === "string" && it.type === "text/plain",
        );
        if (hasTextItem) {
          ev.preventDefault();
          ev.stopPropagation();
          const text = ev.clipboardData?.getData("text/plain") ?? "";
          if (text) socket.send({ type: "data", payload: text });
        }
      };
      container.addEventListener("paste", handler, { capture: true });
      return () => {
        container.removeEventListener("paste", handler, { capture: true } as EventListenerOptions);
      };
    }, [taskId, socket, onGitignoreSuggestion, onPasteImageError]);

    return (
      <div
        className="flex h-full min-h-0 w-full flex-col"
        data-testid="embedded-terminal"
        data-ws-open={socket.open ? "true" : "false"}
        data-ws-ready={socket.ready ? "true" : "false"}
        data-role={socket.role ?? "unknown"}
      >
        {readOnly ? (
          <div
            className="border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
            data-testid="embedded-terminal-readonly"
          >
            Read-only — another tab is the active writer for this task.
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-hidden"
          tabIndex={-1}
          data-testid="embedded-terminal-canvas"
        />
      </div>
    );
  },
);
