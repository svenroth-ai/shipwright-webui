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

import { useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import {
  createActivationRepaint,
  type ActivationRepaintHandle,
} from "./activation-repaint";

/** WS-send shape consumed by this hook — duck-typed to avoid hook-internal coupling. */
type ResizeSendFn = (msg: { type: "resize"; cols: number; rows: number }) => void;

/** Resize throttle window. ConPTY redraws the line on every SIGWINCH; we don't want to drown it. */
const RESIZE_THROTTLE_MS = 250;

// Post-layout-change repaint is TWO complementary mechanisms — do NOT collapse
// them (iterate-2026-06-22, Chesterton's fence):
//   1. DATA-DRIVEN settle window (`repaint-on-settle.ts`) — armed here via
//      `settleArmRef`; repaints on each parsed write. Heals Claude's late
//      async redraw, but ONLY while data flows.
//   2. DATA-INDEPENDENT trailing repaints (`activation-repaint.ts`) — scheduled
//      here on tab-activation + visibility/focus; fires regardless of data, so
//      an IDLE session (no writes) still clears the stale display:none→block
//      WebGL frame the single synchronous `term.refresh` below misses.
// The synchronous immediate `term.refresh(0, rows-1)` is also RETAINED (fast
// path when composite is already settled).

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
  /**
   * Arm the data-driven settle-repaint window (`repaint-on-settle.ts`) — held
   * behind a ref because the settle handle is created in EmbeddedTerminal's
   * mount-effect, which commits AFTER this hook's effects. Optional so the
   * hook stays usable in isolation (unit tests pass a spy).
   */
  settleArmRef?: RefObject<(() => void) | null>;
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
    settleArmRef,
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

  // Data-independent trailing repaints (`activation-repaint.ts`) — lazily
  // created once; reads term/disposed through the stable refs the hook owns.
  const activationRepaintRef = useRef<ActivationRepaintHandle | null>(null);
  if (activationRepaintRef.current === null) {
    activationRepaintRef.current = createActivationRepaint(
      () => termRef.current,
      () => disposedRef.current,
    );
  }
  // Cancel any pending passes on unmount (timers self-guard on disposedRef,
  // but clearing is cheaper than waiting them out).
  useEffect(() => () => activationRepaintRef.current?.clear(), []);

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
      // The settle-repaint window is armed internally by `term.onResize`
      // (repaint-on-settle.ts) when this fit changes cols/rows, so the RO
      // path schedules no repaint of its own.
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
    // Immediate best-effort refresh — repairs the display:none stale frame.
    try {
      term.refresh(0, term.rows - 1);
    } catch {
      /* term mid-dispose */
    }
    // Arm the data-driven settle window. A Transcript→Terminal switch may NOT
    // change cols/rows (same pane size), so `term.onResize` won't fire — arm
    // explicitly so Claude's late async redraw still gets repainted clean.
    settleArmRef?.current?.();
    // Data-independent trailing repaints: an IDLE session emits no writes, so
    // the settle window above does nothing — these clear the stale frame the
    // single synchronous refresh above misses (display:none→block composite).
    activationRepaintRef.current?.schedule();
    const cols = term.cols;
    const rows = term.rows;
    if (
      cols !== lastActiveResizeRef.current.cols ||
      rows !== lastActiveResizeRef.current.rows
    ) {
      lastActiveResizeRef.current = { cols, rows };
      socketSendRef.current({ type: "resize", cols, rows });
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
      // Arm the settle window: returning from the iOS home screen / a bfcache
      // restore may not change dims, so `term.onResize` won't fire — arm
      // explicitly so a late redraw over a reconnected WS repaints clean.
      settleArmRef?.current?.();
      // Data-independent trailing repaints — same idle-session gap as the
      // tab-activation path (a focus/visibility restore with no new output).
      activationRepaintRef.current?.schedule();
      const cols = term.cols;
      const rows = term.rows;
      if (
        cols !== lastSentRef.current.cols ||
        rows !== lastSentRef.current.rows
      ) {
        lastSentRef.current = { cols, rows };
        socketSendRef.current({ type: "resize", cols, rows });
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
