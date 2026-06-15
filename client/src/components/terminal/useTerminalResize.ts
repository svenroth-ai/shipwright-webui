/*
 * useTerminalResize — ResizeObserver + tab-activation refit + safeFit guard.
 *
 * Extracted from EmbeddedTerminal.tsx (Campaign C / C5, 2026-05-26).
 * Behaviour bit-perfect with the source:
 *   - ResizeObserver throttled at 250 ms with trailing-edge fire.
 *   - Tab-activation refit + post-activation `term.refresh(0, rows-1)`
 *     (commit 207f5c3 pattern — display:none repair).
 *   - safeFit hardening (ADR-084): short-circuits when disposed OR when
 *     the xterm renderer reports zero cell dims.
 *   - WS `resize` frame emitted with cols/rows; client-side dedupe of
 *     no-op resizes (iterate v0.8.6 AC-2).
 *
 * Plan-review HIGH/MED resolutions:
 *   - gemini #1: callback `socketSend` is held via a latest-ref so the
 *     observer / setTimeout closures never capture a stale reference.
 *   - openai #6 MED: pending throttled timeout is cancelled on cleanup,
 *     and `disposedRef` gates the trailing-edge fire so a late
 *     setTimeout callback that wins the race against unmount is a
 *     safe no-op.
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/** WS-send shape consumed by this hook — duck-typed to avoid hook-internal coupling. */
type ResizeSendFn = (msg: { type: "resize"; cols: number; rows: number }) => void;

/** Resize throttle window. ConPTY redraws the line on every SIGWINCH; we don't want to drown it. */
const RESIZE_THROTTLE_MS = 250;

/**
 * Trailing full-viewport repaint delays (ms) after a dimension change. Claude's
 * alt-buffer TUI redraws ASYNC after the SIGWINCH, and the WebGL partial-dirty
 * detection leaves stale cells (old input-box border, floating title) across
 * the reflow. Two staggered `term.refresh` passes clear them — fast + slow
 * redraw. Same partial-dirty class as `scroll-repaint.ts`. (Rationale: ADR.)
 */
export const POST_RESIZE_REPAINT_DELAYS_MS = [130, 350] as const;

/**
 * Defence against two xterm hazards (ADR-084):
 *
 *   (a) post-dispose stragglers: an async tail of `fit.fit()` running after
 *       `term.dispose()` would access `term._core._renderService.dimensions`
 *       (nulled by dispose) and throw `Cannot read properties of undefined
 *       (reading 'dimensions')`. That async tail escapes the existing
 *       try/catch frames around the synchronous `fit.fit()` call.
 *
 *   (b) pre-renderer-ready: between `new Terminal()` and the first
 *       fully-rendered frame, `_renderService` may exist but `dimensions`
 *       reports zero `css.cell.width / height`. FitAddon's
 *       `proposeDimensions()` would then compute `Math.floor(width/0) → NaN`.
 *
 * Brittleness guard (ADR-084 external review gemini #2): if `_core` /
 * `_renderService` is missing ENTIRELY (e.g. a future xterm refactor
 * renames private internals), DON'T silently short-circuit — fall
 * through to `fit.fit()` inside the try/catch so the path keeps working.
 * Only "renderer present but dimensions invalid" short-circuits.
 *
 * `disposed` is a plain boolean — caller passes `disposedRef.current` so
 * React's render isolation doesn't capture a stale `false`.
 */
type XtermCorePeek = {
  _renderService?: {
    dimensions?: {
      css?: { cell?: { width?: number; height?: number } };
    };
  };
};
export function safeFit(
  fit: FitAddon | null,
  term: Terminal | null,
  disposed: boolean,
): boolean {
  if (disposed || !fit || !term) return false;
  try {
    const core = (term as unknown as { _core?: XtermCorePeek })._core;
    if (core?._renderService) {
      const dims = core._renderService.dimensions;
      const cellW = dims?.css?.cell?.width ?? 0;
      const cellH = dims?.css?.cell?.height ?? 0;
      if (!dims || cellW === 0 || cellH === 0) return false;
    }
    fit.fit();
    return true;
  } catch {
    // Catches the async-tail TypeError from accessing dimensions on a
    // disposed renderer.
    return false;
  }
}

export interface UseTerminalResizeOptions {
  /** The DOM container — observed by ResizeObserver. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The mounted xterm instance. */
  termRef: RefObject<Terminal | null>;
  /** The FitAddon — caller owns the lifecycle (created in `xtermAddons`). */
  fitAddonRef: RefObject<FitAddon | null>;
  /** True once cleanup has nulled the term/fit refs (ADR-084). */
  disposedRef: RefObject<boolean>;
  /** Send a `{type:"resize", cols, rows}` envelope on the WS. */
  socketSend: ResizeSendFn;
  /** Parent's tab-active flag — true while the Terminal tab is visible. */
  active: boolean;
}

/**
 * Wire the resize observer + tab-activation refit effects. Returns void —
 * pure side-effect hook. Both effects are gated on `termRef.current` so
 * the hook is safe to call before the xterm mount effect runs.
 */
export function useTerminalResize(opts: UseTerminalResizeOptions): void {
  const {
    containerRef,
    termRef,
    fitAddonRef,
    disposedRef,
    socketSend,
    active,
  } = opts;

  // Plan-review gemini #1: pin `socketSend` behind a latest-ref so the
  // ResizeObserver / setTimeout closures don't capture a stale reference
  // across parent re-renders.
  const socketSendRef = useRef(socketSend);
  useEffect(() => {
    socketSendRef.current = socketSend;
  }, [socketSend]);

  // Cross-render refs for the throttle window + WS dedupe.
  const lastResizeAtRef = useRef(0);
  const lastResizePendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<{ cols: number; rows: number }>({
    cols: -1,
    rows: -1,
  });

  // Trailing repaint timers — see POST_RESIZE_REPAINT_DELAYS_MS.
  const trailingRepaintTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTrailingRepaints = useCallback(() => {
    for (const t of trailingRepaintTimersRef.current) clearTimeout(t);
    trailingRepaintTimersRef.current = [];
  }, []);
  const scheduleTrailingRepaint = useCallback(() => {
    clearTrailingRepaints();
    for (const delay of POST_RESIZE_REPAINT_DELAYS_MS) {
      trailingRepaintTimersRef.current.push(
        setTimeout(() => {
          if (disposedRef.current) return;
          const term = termRef.current;
          if (!term) return;
          try {
            term.refresh(0, term.rows - 1);
          } catch {
            /* term mid-dispose */
          }
        }, delay),
      );
    }
  }, [clearTrailingRepaints, termRef, disposedRef]);
  // Cancel any pending trailing repaint on unmount.
  useEffect(() => clearTrailingRepaints, [clearTrailingRepaints]);

  // -------- ResizeObserver effect (one-shot per mount) ----------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeAndSend = (): void => {
      const fit = fitAddonRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      // safeFit short-circuits when disposed OR when the renderer reports
      // zero cell dims; either case means we have nothing useful to send.
      if (!safeFit(fit, term, disposedRef.current)) return;
      const cols = term.cols;
      const rows = term.rows;
      if (cols === lastSentRef.current.cols && rows === lastSentRef.current.rows) {
        return;
      }
      lastSentRef.current = { cols, rows };
      socketSendRef.current({ type: "resize", cols, rows });
      scheduleTrailingRepaint();
    };

    const ro = new ResizeObserver(() => {
      // Plan-review openai #6 — also defend against disposed-then-late RO fire.
      if (disposedRef.current) return;
      const now = Date.now();
      if (now - lastResizeAtRef.current >= RESIZE_THROTTLE_MS) {
        lastResizeAtRef.current = now;
        resizeAndSend();
      } else if (!lastResizePendingRef.current) {
        lastResizePendingRef.current = setTimeout(() => {
          lastResizePendingRef.current = null;
          // Plan-review openai #6 — trailing-edge fire MUST check disposedRef.
          if (disposedRef.current) return;
          lastResizeAtRef.current = Date.now();
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
    };
    // Refs are stable; only the container element changes drive re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Tab-activation refit + refresh ----------
  // When the Terminal tab becomes active, re-fit (hidden containers report
  // 0×0) AND `term.refresh` so the renderer atlas drops any stale 0×0
  // state from when `term.open(container)` ran while the tab was hidden
  // (the original "broken render after first navigation" bug).
  const lastActiveResizeRef = useRef<{ cols: number; rows: number }>({
    cols: -1,
    rows: -1,
  });
  useEffect(() => {
    if (!active) return;
    const fit = fitAddonRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    safeFit(fit, term, disposedRef.current);
    // term.refresh(0, rows-1) inside a try/catch — best-effort refresh.
    try {
      term.refresh(0, term.rows - 1);
    } catch {
      /* term mid-dispose */
    }
    const cols = term.cols;
    const rows = term.rows;
    if (
      cols !== lastActiveResizeRef.current.cols ||
      rows !== lastActiveResizeRef.current.rows
    ) {
      lastActiveResizeRef.current = { cols, rows };
      socketSendRef.current({ type: "resize", cols, rows });
      scheduleTrailingRepaint();
    }
    // socketSend is latest-ref'd; deps are intentionally narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // -------- Window visibility / focus / bfcache repaint ----------
  // The WebGL renderer (ADR-099) only force-repaints on three triggers:
  // ResizeObserver, tab activation (above), and scroll (scroll-repaint.ts).
  // When the browser WINDOW or TAB regains visibility/focus — returning to a
  // backgrounded Edge window, switching monitors, or a bfcache restore —
  // Chromium may have stopped painting or DROPPED the WebGL canvas while it
  // was hidden, leaving a STALE frame ("smear"). None of the three triggers
  // fire on those events, so the smear persists until a manual resize. This
  // effect wires the same remedy to those events:
  //   - safeFit() re-fits — heals the width/DPR-changed case (e.g. the window
  //     moved to a smaller monitor: content wrapped at the old width); a real
  //     dimension change ALSO dedupe-sends the WS resize so Claude's alt-buffer
  //     TUI gets a SIGWINCH and redraws at the new width.
  //   - term.refresh(0, rows-1) marks every visible row dirty and repaints —
  //     heals the same-width stale-GPU-frame case the resize alone misses.
  // `document.hidden` short-circuits the visibilitychange→hidden edge.
  useEffect(() => {
    const repaint = (): void => {
      if (disposedRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const fit = fitAddonRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      safeFit(fit, term, disposedRef.current);
      try {
        term.refresh(0, term.rows - 1);
      } catch {
        /* term mid-dispose */
      }
      const cols = term.cols;
      const rows = term.rows;
      if (
        cols !== lastSentRef.current.cols ||
        rows !== lastSentRef.current.rows
      ) {
        lastSentRef.current = { cols, rows };
        socketSendRef.current({ type: "resize", cols, rows });
        scheduleTrailingRepaint();
      }
    };
    window.addEventListener("focus", repaint);
    window.addEventListener("pageshow", repaint);
    document.addEventListener("visibilitychange", repaint);
    return () => {
      window.removeEventListener("focus", repaint);
      window.removeEventListener("pageshow", repaint);
      document.removeEventListener("visibilitychange", repaint);
    };
    // Refs are stable; one-shot per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
