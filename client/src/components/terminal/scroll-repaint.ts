/*
 * scroll-repaint — force a FULL-viewport WebGL repaint on scroll.
 *
 * iterate-2026-06-09-fix-terminal-scroll-smear.
 *
 * Bug: tables smear ("ghost" glyphs) when the user scrolls. Root cause —
 * the WebGL renderer (ADR-099) repaints only the partial dirty-row range
 * xterm's per-cell change detection computes. After a viewport scroll,
 * cells whose NEW content equals the glyph already drawn at that screen
 * position are skipped, but the GPU still shows the stale glyph from the
 * previously-displayed logical row. Tables maximise these collisions
 * (repeated spaces / box-drawing borders / aligned columns) — hence
 * "only tables". A full `term.refresh(0, rows-1)` marks every visible row
 * dirty and repaints. Empirically confirmed: a window resize / tab switch
 * (which already force a full refresh — useTerminalResize /
 * useTerminalShellEffects) heal the smear today. This module wires the
 * SAME remedy to the scroll INPUT, which had no refresh hook (the only
 * pre-existing scroll-time repaint was xterm's own partial one — see the
 * note in useReplayDrainGate).
 *
 * Two triggers, because the two xterm buffers scroll differently:
 *   - normal buffer → `term.onScroll` fires on viewportY change (wheel,
 *     scrollbar, keyboard PageUp/Down, touch `term.scrollLines`). The
 *     buffer change is already applied, so a next-frame full refresh lands
 *     clean.
 *   - alt buffer → `onScroll` is SILENT (alt-buffer has no scrollback;
 *     viewportY stays 0). Claude Code's TUI (CLAUDE.md rule 22 / ADR-095,
 *     `enable-mouse-events`) requested mouse tracking, so it redraws via
 *     WS writes in response to the wheel escape — ASYNC, after the wheel
 *     event. A passive `wheel` listener catches that path; the trailing
 *     debounce fires the refresh AFTER the redraw write lands.
 *
 * Scheduling: at most one `term.refresh` per animation frame while
 * scrolling (live-clean for the synchronous normal-buffer case) PLUS one
 * trailing refresh `SCROLL_REPAINT_TRAILING_MS` after the last scroll
 * input settles (catches the async alt-buffer redraw). Both are no-ops
 * when idle. `refresh` is GPU-cheap for a single viewport, and only fires
 * during/just-after a user scroll.
 *
 * ZERO React imports — pure imperative attach/dispose, unit-tested in
 * isolation (scroll-repaint.test.ts), mirroring touch-scroll.ts.
 */

import type { Terminal } from "@xterm/xterm";

/** Trailing-edge delay (ms) — long enough to cover a local WS round-trip so
 *  the alt-buffer redraw write has landed before the final refresh. */
export const SCROLL_REPAINT_TRAILING_MS = 150;

export interface ScrollRepaintDeps {
  /** Test seam for `requestAnimationFrame`. */
  requestFrame?: (cb: () => void) => number;
  /** Test seam for `cancelAnimationFrame`. */
  cancelFrame?: (handle: number) => void;
  /** Test seam for `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Test seam for `clearTimeout`. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Attach scroll-triggered full-viewport repaint to an open xterm. Returns a
 * disposer that unbinds the wheel listener, disposes the onScroll handler,
 * and cancels any pending frame / trailing timer.
 *
 * `isDisposed` is read at every async tail so a refresh never lands on a
 * mid-dispose terminal (ADR-084 ordering parity with the shell mount-effect).
 */
export function attachScrollRepaint(
  term: Terminal,
  container: HTMLElement,
  isDisposed: () => boolean,
  deps: ScrollRepaintDeps = {},
): () => void {
  const raf = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const setT = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = deps.clearTimer ?? ((h) => clearTimeout(h));

  let frame: number | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;

  const repaintFull = (): void => {
    if (isDisposed()) return;
    try {
      term.refresh(0, term.rows - 1);
    } catch {
      /* term mid-dispose — the next scroll reschedules a fresh repaint */
    }
  };

  const schedule = (): void => {
    if (isDisposed()) return;
    // Per-frame live repaint (coalesced — the synchronous normal-buffer case).
    if (frame === null) {
      frame = raf(() => {
        frame = null;
        repaintFull();
      });
    }
    // Trailing repaint (resets on each input) — the async alt-buffer redraw
    // lands after the wheel, so refresh once more when scrolling settles.
    if (trailing !== null) clearT(trailing);
    trailing = setT(() => {
      trailing = null;
      repaintFull();
    }, SCROLL_REPAINT_TRAILING_MS);
  };

  // Normal buffer: viewport scroll of any kind (wheel / scrollbar / keyboard
  // / touch term.scrollLines) flips viewportY → onScroll fires.
  const scrollDisposable = term.onScroll(schedule);

  // Alt buffer: onScroll is silent; the raw wheel is the only signal. Passive
  // — we never preventDefault, so xterm's own wheel handler still runs and
  // forwards the mouse escape to the pty.
  container.addEventListener("wheel", schedule, { passive: true });

  return () => {
    if (frame !== null) {
      caf(frame);
      frame = null;
    }
    if (trailing !== null) {
      clearT(trailing);
      trailing = null;
    }
    try {
      scrollDisposable.dispose();
    } catch {
      /* best-effort — term may already be disposed */
    }
    container.removeEventListener("wheel", schedule);
  };
}
