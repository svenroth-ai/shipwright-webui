/*
 * terminalWsContract.ts — wire types for the embedded-terminal WebSocket.
 *
 * Split out of `useTerminalSocket.ts` (iterate-2026-07-30): the hook owns the
 * socket LIFECYCLE (connect, reconnect schedule, liveness), while the envelope
 * CONTRACT is a separate concern that both the hook and its consumers name. The
 * hook is a long-standing bloat-baseline entry, so the contract earns its own file
 * rather than pushing the lifecycle module further over its ceiling.
 *
 * These are verbatim mirrors of the server shapes — no cross-package import, per
 * DO-NOT #7. Server side: `server/src/terminal/ws-upgrade-handler.ts` (`WSInbound`)
 * and `server/src/terminal/backpressure-telemetry.ts` (`BackpressureNotice`).
 */

/**
 * Outbound envelope.
 *   - `redraw` asks the server to re-apply the pty's current size so a fullscreen
 *     TUI repaints from scratch. Dimension-less on purpose — see CLAUDE.md rule 29
 *     and `useTerminalSizeSync` (iterate-2026-07-27).
 *   - `resync` asks for a fresh full-grid `replay_snapshot` after the server
 *     reported dropped bytes. `deliverWithBackpressure` discards a saturated
 *     connection's chunk and NEVER resends it, so Claude's differential repaints
 *     (CUP + CUF cell-skips, which do not erase) keep painting onto the hole and
 *     leave stale characters that never heal. Re-applying the grid is the repair;
 *     it is not another repaint heal (see `useBackpressureResync`).
 */
export type TerminalOutbound =
  | { type: "data"; payload: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "redraw" }
  | { type: "resync" };

/**
 * Payload of the inbound `backpressure` envelope. Fired when a saturation episode
 * OPENS and again when it CLOSES.
 *
 * `droppedBytes` is cumulative FOR THE EPISODE. Before iterate-2026-07-30 the server
 * reported only the FIRST dropped chunk's size and only once per episode, so the
 * losses could not be summed even in principle — the episode-end notice is what
 * makes them countable. All fields beyond `droppedBytes` are additive; an older
 * server omitting them still delivers a usable notice.
 */
export interface BackpressureInfo {
  droppedBytes: number;
  droppedChunks: number;
  totalDroppedBytes: number;
  episode: number;
  episodeEnded: boolean;
}
