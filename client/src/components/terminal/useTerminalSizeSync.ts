/*
 * useTerminalSizeSync — pty↔xterm width-sync seam
 * (iterate-2026-07-01-terminal-title-wrap-smear).
 *
 * Root cause of the "D er" title-wrap smear: the pty spawns at a hardcoded
 * 120 cols; the client's real (often narrower, half-screen) width reaches it
 * only via a 250 ms-throttled resize. If the auto-launched
 * `claude … --name "<long title>"` runs before that width lands, Claude Code
 * renders its width-sensitive black-on-cyan title-pill banner at 120; on a
 * narrower xterm grid the wrapping banner auto-wraps one extra row and the
 * title's first char collides onto the `>` prompt row.
 *
 *   - `syncSizeNow` fits xterm to its real container and emits the resulting
 *     `resize` on the same ordered WS. Dispatched right before the launch
 *     command (useAutoLaunch `onBeforeDispatch`) so the pty is width-correct
 *     when Claude renders. The server dedupes no-op resizes, so an equal send
 *     is a cheap no-op.
 *   - `onReplaySettled` re-converges a WRITER after a `replay_snapshot`
 *     settles (the snapshot temporarily resized xterm to its serialized
 *     width). A READER keeps the snapshot (writer) width so the wider content
 *     reconstructs faithfully — #150 reader-reflow (iterate-2026-06-15). The
 *     role is read via a render-body latest-ref, NOT a passive effect: an
 *     effect lags a writer→reader reconnect handoff and would momentarily
 *     converge a reader, reflowing the wide snapshot into the narrow viewport
 *     (external review MEDIUM). `role` stays sticky across a close, so a fresh
 *     reader attach reads `null` → skip until its `ready` lands.
 */

import { useCallback, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { safeFit } from "./safe-fit";
import type { TerminalRole } from "../../hooks/useTerminalSocket";

export interface UseTerminalSizeSyncOptions {
  termRef: RefObject<Terminal | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  disposedRef: RefObject<boolean>;
  socketSend: (msg: { type: "resize"; cols: number; rows: number }) => void;
  /** Current WS role (writer/reader/null) — read live for the writer gate. */
  role: TerminalRole | null;
}

export interface TerminalSizeSyncHandle {
  /** Fit + emit resize so the pty matches the client's real grid. Wire into
   *  `useAutoLaunch({ onBeforeDispatch })`. */
  syncSizeNow: () => void;
  /** Writer-gated post-replay convergence. Wire into `useReplayDrainGate`. */
  onReplaySettled: () => void;
}

export function useTerminalSizeSync(
  opts: UseTerminalSizeSyncOptions,
): TerminalSizeSyncHandle {
  const { termRef, fitAddonRef, disposedRef, socketSend, role } = opts;

  const syncSizeNow = useCallback(() => {
    const term = termRef.current;
    const fit = fitAddonRef.current;
    if (!term || !fit) return;
    if (safeFit(fit, term, disposedRef.current)) {
      socketSend({ type: "resize", cols: term.cols, rows: term.rows });
    }
  }, [termRef, fitAddonRef, disposedRef, socketSend]);

  const roleRef = useRef(role);
  roleRef.current = role;

  const onReplaySettled = useCallback(() => {
    if (roleRef.current === "writer") syncSizeNow();
  }, [syncSizeNow]);

  return { syncSizeNow, onReplaySettled };
}
