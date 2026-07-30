/*
 * useBackpressureResync — ask the server for a fresh full-grid snapshot after it
 * reported dropped bytes (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28).
 *
 * WHY. When the WS is saturated, `PtyManager.deliverWithBackpressure` DISCARDS the
 * pty chunk and never resends it. Claude Code repaints DIFFERENTIALLY — it addresses
 * a row with CUP then emits `ESC [ 1 C` (CUF) to SKIP cells it believes already
 * correct — and CUF does not erase. So every later repaint lands on a holed grid and
 * the skipped cells keep STALE characters (`sie und habe` -> `sie.undthabe`). Where
 * the drop lands at the end of a burst — a table — nothing repaints afterwards and
 * it never heals: the user's "es bleibt dann einfach".
 *
 * Before this hook the loss was silent END TO END: the server logged nothing, and
 * `EmbeddedTerminal`'s `onBackpressure` prop was NEVER SUPPLIED by TaskDetailPage,
 * so the callback was a no-op. Nothing counted the loss and nothing repaired it.
 *
 * The repair is a RESYNC, not another repaint: re-apply the whole grid. This is
 * deliberately NOT a tenth repaint/refresh heal — that class failed nine times
 * (CLAUDE.md rules 28 + 29), because a repaint cannot invent bytes the browser
 * never received. Only the server's mirror still has them.
 *
 * Debounced rather than immediate: the notice arrives while the socket is still
 * saturated, and a snapshot frame pushed into a full socket buffer is the one thing
 * guaranteed not to arrive. Waiting a beat lets the socket drain first. The server
 * throttles independently (`resync-gate.ts`), so a burst of notices cannot turn into
 * a serialize storm.
 */

import { useCallback, useEffect, useRef } from "react";
import type { BackpressureInfo, TerminalOutbound } from "../../hooks/useTerminalSocket";

/**
 * Delay between a backpressure notice and the resync request. Long enough for a
 * saturated socket to drain, short enough that the user does not sit in front of a
 * corrupted screen.
 */
export const RESYNC_DEBOUNCE_MS = 400;

export interface UseBackpressureResyncOptions {
  send: (msg: TerminalOutbound) => void;
  /** Forwarded after the resync is scheduled, for callers that surface a banner. */
  onBackpressure?: (info: BackpressureInfo) => void;
  debounceMs?: number;
}

export interface BackpressureResyncHandle {
  /** Wire into `useTerminalSocket({ onBackpressure })`. */
  onBackpressure: (info: BackpressureInfo) => void;
  /**
   * Request a resync for a reason other than a server notice — currently the
   * replay-drain queue overflowing, which also loses output (DO-NOT #18).
   */
  requestResync: () => void;
}

export function useBackpressureResync(
  opts: UseBackpressureResyncOptions,
): BackpressureResyncHandle {
  const { send, onBackpressure, debounceMs = RESYNC_DEBOUNCE_MS } = opts;

  // Latest-refs so a re-render never re-arms or drops a pending request.
  const sendRef = useRef(send);
  sendRef.current = send;
  const onBackpressureRef = useRef(onBackpressure);
  onBackpressureRef.current = onBackpressure;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestResync = useCallback(() => {
    // Coalesce: one pending request, however many notices arrive. Re-arming on
    // every notice would fire a resync per dropped-chunk episode edge.
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      sendRef.current({ type: "resync" });
    }, debounceMs);
  }, [debounceMs]);

  const handleBackpressure = useCallback(
    (info: BackpressureInfo) => {
      // Guard on the byte count, not the envelope's arrival: a notice reporting
      // nothing lost has no hole to repair.
      const lost = info.droppedBytes > 0 || info.totalDroppedBytes > 0;
      /*
       * Ask only on the notice that CLOSES the episode.
       *
       * Asking on the OPENING notice was wrong twice over (external review):
       *   - the socket is still saturated then, so the answer — the largest single
       *     frame the protocol has — is queued onto the very congested socket that
       *     just dropped output, and a flapping connection settles into a resync
       *     loop. Each settled replay sends rule 29's `redraw`, and that loop is
       *     exactly the v0.8.6 banner spam `useTerminalSizeSync` warns about;
       *   - a 400 ms debounce was a GUESS at when the socket drained, and it raced
       *     the server's 1 s resync floor: an episode lasting 400-1000 ms had its
       *     post-drain request silently refused with nothing to retry it, leaving
       *     the holes permanently — the defect this iterate exists to remove.
       *
       * `episodeEnded` is the server telling us delivery actually resumed, and it
       * carries the accurate total. One request per episode, always post-drain.
       * An older server never sets it, so fall back to the debounce there.
       */
      if (!lost) {
        onBackpressureRef.current?.(info);
        return;
      }
      const legacyServer = info.episode === 0 && info.droppedChunks === 0;
      if (info.episodeEnded || legacyServer) requestResync();
      onBackpressureRef.current?.(info);
    },
    [requestResync],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return { onBackpressure: handleBackpressure, requestResync };
}
