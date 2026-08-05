/*
 * backpressure-telemetry.ts — accounting + notification policy for the WS
 * drop-while-saturated path (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28).
 *
 * WHY THIS MODULE EXISTS. `PtyManager.deliverWithBackpressure` discards a pty
 * chunk when the WS already has more than `wsBufferBytes` queued, and never
 * resends it. That path shipped with ADR-067 and logged **nothing at all**, so
 * after nine fixes in the terminal-smear class it was still UNPROVEN whether it
 * fires in real sessions — the first thing this iterate had to establish. It also
 * notified the client only ONCE per saturation episode, reporting the size of the
 * FIRST dropped chunk only, which made the losses uncountable even in principle.
 *
 * This module owns three things that belong together and were previously either
 * absent or smeared across the pty lifecycle owner:
 *
 *   1. ACCOUNTING — per connection: bytes and chunks lost in the current
 *      saturation episode, plus lifetime totals and an episode counter.
 *   2. NOTIFICATION POLICY — one notice when an episode opens (so the client can
 *      react promptly) and one when it closes (carrying the accurate episode
 *      total). Deliberately NOT one per dropped chunk: pushing more frames into
 *      an already-saturated socket is exactly the wrong move.
 *   3. RATE-LIMITED LOGGING — the FIRST line for a connection always emits (a real
 *      event must never be invisible); everything after it is throttled, INCLUDING
 *      episode open/close transitions. Throttling only the mid-episode lines was
 *      not enough: a connection whose `bufferedAmount` flaps across the threshold
 *      opens and closes episodes repeatedly and would emit two lines per flap
 *      forever, which is exactly the log flood AC-1 forbids (external review).
 *      Every emitted line carries the cumulative counters plus the number of
 *      suppressed lines, so throttling loses evidence of TIMING, never of VOLUME.
 *
 * The per-connection episode flag lives here rather than on `PtyEntry` (where it
 * was `backpressureRaised`): the flag exists only to serve the notification policy,
 * so it belongs with the policy.
 *
 * Keyed by a plain `Map` over `unknown`, deliberately NOT a `WeakMap`: `PtyManager`
 * types a connection as `unknown` and its public API accepts a primitive, which a
 * `WeakMap` key would reject with a runtime `TypeError` on the hot delivery path
 * (external review). `release()` is called from the same connection-teardown site
 * that used to delete the old per-entry flag, so the lifecycle is unchanged.
 */

/**
 * Payload of the `{type:"backpressure"}` WS envelope. `droppedBytes` keeps its
 * original name and stays wire-compatible: at episode-open it is still the first
 * dropped chunk's size. Its MEANING is now "bytes lost in this episode so far",
 * which is what makes the loss countable (the old value could not be summed).
 *
 * Mirrored client-side in `client/src/hooks/useTerminalSocket.ts`. Additive only —
 * an older client reading just `droppedBytes` keeps working.
 */
export interface BackpressureNotice {
  /** Bytes lost in the CURRENT saturation episode, cumulative. */
  droppedBytes: number;
  /** Chunks lost in the current episode. */
  droppedChunks: number;
  /** Bytes lost across this connection's whole lifetime. */
  totalDroppedBytes: number;
  /** 1-based index of this saturation episode on this connection. */
  episode: number;
  /** True when delivery has resumed — this notice closes the episode. */
  episodeEnded: boolean;
}

interface ConnAccount {
  taskId: string;
  /** Non-null while a saturation episode is open. */
  episodeBytes: number | null;
  episodeChunks: number;
  totalDroppedBytes: number;
  totalDroppedChunks: number;
  episodes: number;
  /** Timestamp of the last emitted log line, for throttling. */
  lastLogAt: number;
  /** Whether this connection has ever emitted a line (the first always emits). */
  everLogged: boolean;
  /** Lines withheld by the throttle since the last emitted one. */
  suppressed: number;
}

export interface BackpressureTelemetryOpts {
  now?: () => number;
  log?: (msg: string) => void;
  /** Minimum gap between mid-episode log lines, per connection. */
  logIntervalMs?: number;
}

/** Default throttle for mid-episode lines. Open/close always log. */
export const DEFAULT_LOG_INTERVAL_MS = 5_000;

export class BackpressureTelemetry {
  private readonly accounts = new Map<unknown, ConnAccount>();
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly logIntervalMs: number;

  constructor(opts: BackpressureTelemetryOpts = {}) {
    this.now = opts.now ?? (() => Date.now());
    // eslint-disable-next-line no-console
    this.log = opts.log ?? ((m) => console.warn(m));
    this.logIntervalMs = opts.logIntervalMs ?? DEFAULT_LOG_INTERVAL_MS;
  }

  private account(taskId: string, conn: unknown): ConnAccount {
    let a = this.accounts.get(conn);
    if (!a) {
      a = {
        taskId,
        episodeBytes: null,
        episodeChunks: 0,
        totalDroppedBytes: 0,
        totalDroppedChunks: 0,
        episodes: 0,
        lastLogAt: 0,
        everLogged: false,
        suppressed: 0,
      };
      this.accounts.set(conn, a);
    }
    return a;
  }

  /**
   * Emit `body` unless the throttle withholds it. The first line for a connection
   * always emits; afterwards at most one line per `logIntervalMs`, whatever its
   * kind. A withheld line is counted so the next emitted one can disclose it —
   * suppression must cost timing detail, never the volume of the loss.
   */
  private throttledLog(a: ConnAccount, body: string): void {
    const now = this.now();
    if (a.everLogged && now - a.lastLogAt < this.logIntervalMs) {
      a.suppressed += 1;
      return;
    }
    const withheld = a.suppressed > 0 ? ` (+${a.suppressed} similar suppressed)` : "";
    a.suppressed = 0;
    a.everLogged = true;
    a.lastLogAt = now;
    this.log(
      `${body} sessionDropped=${a.totalDroppedBytes}B/${a.totalDroppedChunks} chunks` +
        ` episodes=${a.episodes}${withheld}`,
    );
  }

  /**
   * Record one discarded chunk.
   *
   * @returns the notice to forward to the client when this drop OPENS an
   *   episode, or `null` while an episode is already open (the client has been
   *   told; every further chunk is still counted).
   */
  onDrop(taskId: string, conn: unknown, bytes: number): BackpressureNotice | null {
    const a = this.account(taskId, conn);
    const opening = a.episodeBytes === null;
    if (opening) {
      a.episodeBytes = 0;
      a.episodeChunks = 0;
      a.episodes += 1;
    }
    a.episodeBytes = (a.episodeBytes ?? 0) + bytes;
    a.episodeChunks += 1;
    a.totalDroppedBytes += bytes;
    a.totalDroppedChunks += 1;

    this.throttledLog(
      a,
      opening
        ? `[pty-manager] WS saturated — DISCARDING pty output for task=${a.taskId} ` +
            `episode=${a.episodes} firstChunk=${bytes}B ` +
            `(dropped and never resent; client will be asked to resync)`
        : `[pty-manager] WS still saturated — task=${a.taskId} episode=${a.episodes} ` +
            `episodeDropped=${a.episodeBytes}B/${a.episodeChunks} chunks`,
    );

    return opening ? this.notice(a, false) : null;
  }

  /**
   * Record a successful delivery. Closes an open episode.
   *
   * @returns the closing notice (carrying the accurate episode total) when an
   *   episode was open, else `null`. Called on every delivery, so the no-episode
   *   path is a single WeakMap lookup.
   */
  onDelivered(taskId: string, conn: unknown): BackpressureNotice | null {
    const a = this.accounts.get(conn);
    if (!a || a.episodeBytes === null) return null;
    const notice = this.notice(a, true);
    this.throttledLog(
      a,
      `[pty-manager] WS drained — task=${a.taskId} episode=${a.episodes} ` +
        `episodeDropped=${a.episodeBytes}B/${a.episodeChunks} chunks`,
    );
    a.episodeBytes = null;
    a.episodeChunks = 0;
    return notice;
  }

  /** Lifetime counters for a connection — diagnostics and tests. */
  stats(conn: unknown): Readonly<ConnAccount> | undefined {
    return this.accounts.get(conn);
  }

  /**
   * Explicit cleanup on detach — called from the same connection-teardown site that
   * used to delete the old per-entry `backpressureRaised` flag, so accounts do not
   * outlive their connection.
   */
  release(conn: unknown): void {
    this.accounts.delete(conn);
  }

  private notice(a: ConnAccount, episodeEnded: boolean): BackpressureNotice {
    return {
      droppedBytes: a.episodeBytes ?? 0,
      droppedChunks: a.episodeChunks,
      totalDroppedBytes: a.totalDroppedBytes,
      episode: a.episodes,
      episodeEnded,
    };
  }
}
