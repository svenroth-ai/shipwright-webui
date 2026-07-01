/*
 * useReplayDrainGate — ADR-108 replay-drain gate (Campaign C / C5).
 *
 * Extracted from EmbeddedTerminal.tsx. Behaviour bit-perfect:
 *   - While a `replay_snapshot` `term.write` is parsing asynchronously,
 *     queue live `data` instead of writing it — otherwise the two
 *     writers interleave and corrupt the xterm buffer (Bug B left-
 *     column glyph-fragment smear).
 *   - Drain queue on completion callback OR watchdog (5 s).
 *   - Generation counter neutralises stale callbacks / superseding
 *     snapshots.
 *   - Byte cap (8 MiB) drops OLDEST queued chunks; never force-drain.
 *
 * Plus prompt-readiness bookkeeping refs (`dataSeenInitiallyRef`,
 * `lastPtyDataAtRef`) consumed by `useAutoLaunch` for the handshake.
 *
 * Exposed primitives are shared with `useAutoLaunch`: both hooks read
 * the same in-flight flag + bookkeeping refs.
 */

import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

export const REPLAY_DRAIN_TIMEOUT_MS = 5_000;
export const REPLAY_DRAIN_MAX_BYTES = 8 * 1024 * 1024;

const utf8ByteLength = (s: string): number =>
  new TextEncoder().encode(s).length;

/**
 * Bundle of refs + handlers the gate exposes. Held entirely in refs (NO
 * React state) so high-frequency `data` envelopes don't trigger re-renders
 * (Plan-review gemini #3 MED — avoid render cascades).
 */
export interface ReplayDrainGateHandle {
  /** Prompt-readiness bookkeeping (also feeds the auto-launch handshake). */
  dataSeenInitiallyRef: RefObject<boolean>;
  lastPtyDataAtRef: RefObject<number>;
  /** Wire into `useTerminalSocket({ onData })`. */
  onDataChunk: (chunk: string) => void;
  /** Wire into `useTerminalSocket({ onReplaySnapshot })`. */
  onReplaySnapshot: (info: {
    data: string;
    cols: number;
    rows: number;
    terminalVersion: string;
  }) => void;
  /** Reset gate on taskId change / unmount / external triggers. */
  resetGate: () => void;
}

export function useReplayDrainGate(
  termRef: RefObject<Terminal | null>,
  disposedRef: RefObject<boolean>,
  /**
   * Fired once a `replay_snapshot` write has settled (drain complete). Used to
   * re-converge a WRITER's xterm — which `onReplaySnapshot` temporarily
   * resized to the snapshot's own (serialized) width for faithful cursor
   * reconstruction — back to the real container width and push the matching
   * resize to the pty, so a re-attach can't strand xterm at a width that
   * differs from Claude's render width (iterate-2026-07-01-terminal-title-
   * wrap-smear). Held behind a latest-ref by the caller; safe to omit.
   */
  onReplaySettled?: () => void,
): ReplayDrainGateHandle {
  const onReplaySettledRef = useRef(onReplaySettled);
  onReplaySettledRef.current = onReplaySettled;
  // Gate refs.
  const replaySnapshotInFlightRef = useRef(false);
  const replayDrainQueueRef = useRef<string[]>([]);
  const replayDrainQueueBytesRef = useRef(0);
  const replayGenerationRef = useRef(0);
  const replayWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prompt-readiness bookkeeping — fed by `onDataChunk`, read by
  // useAutoLaunch's handshake loop. Lives here because the same `onData`
  // chunk updates both signals.
  const dataSeenInitiallyRef = useRef(false);
  const lastPtyDataAtRef = useRef(0);

  const clearReplayWatchdog = useCallback(() => {
    if (replayWatchdogRef.current !== null) {
      clearTimeout(replayWatchdogRef.current);
      replayWatchdogRef.current = null;
    }
  }, []);

  const resetGate = useCallback(() => {
    clearReplayWatchdog();
    replaySnapshotInFlightRef.current = false;
    replayDrainQueueRef.current = [];
    replayDrainQueueBytesRef.current = 0;
    replayGenerationRef.current += 1;
  }, [clearReplayWatchdog]);

  /** Idempotent gate-settle: the FIRST of {completion, watchdog} for
   *  `generation` drains the queue as a single concatenated write. The
   *  loser sees a stale generation and no-ops. */
  const settleReplayGate = useCallback(
    (generation: number, term: Terminal) => {
      if (replayGenerationRef.current !== generation) return;
      replayGenerationRef.current += 1;
      clearReplayWatchdog();
      replaySnapshotInFlightRef.current = false;
      const queued = replayDrainQueueRef.current;
      replayDrainQueueRef.current = [];
      replayDrainQueueBytesRef.current = 0;
      if (disposedRef.current || termRef.current !== term) return;
      try {
        if (queued.length > 0) term.write(queued.join(""));
        term.scrollToBottom();
        // iterate-2026-06-08-fix-terminal-replay-render-refresh — force a
        // FULL-viewport repaint after the replay settles. Without this the
        // terminal "opens unclean until I scroll": xterm's RenderDebouncer
        // only repaints the dirty-row range the bulk snapshot write
        // tracked, and the reset()→write()→scrollToBottom() sequence
        // (WebGL renderer) can leave visible rows stale/blank. The other
        // refresh kicks (useTerminalResize / useTerminalShellEffects) fire
        // on ready/active — BEFORE the later-arriving snapshot — so they
        // never cover the post-replay paint. A user scroll triggers
        // refreshRows() and the viewport finally paints; this does that
        // proactively. Marking every visible row dirty is the same remedy
        // already used for the navigation variant of this render bug.
        term.refresh(0, term.rows - 1);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[terminal] replay drain failed: ${(err as Error).message}`,
        );
      }
      // Re-converge to the real container width (writer-gated by the caller)
      // now that the snapshot has been reconstructed at its own serialized
      // width — closes the "xterm stranded at snapshot cols ≠ Claude's render
      // width" divergence on re-attach.
      onReplaySettledRef.current?.();
    },
    [clearReplayWatchdog, disposedRef, termRef],
  );

  const onDataChunk = useCallback(
    (chunk: string): void => {
      if (!dataSeenInitiallyRef.current) dataSeenInitiallyRef.current = true;
      lastPtyDataAtRef.current = Date.now();
      if (replaySnapshotInFlightRef.current) {
        const queue = replayDrainQueueRef.current;
        queue.push(chunk);
        replayDrainQueueBytesRef.current += utf8ByteLength(chunk);
        // Byte cap — drop OLDEST (ring-buffer trim); never force-drain
        // mid-flight (re-creates Bug B smear). Newest always survives.
        while (
          replayDrainQueueBytesRef.current > REPLAY_DRAIN_MAX_BYTES &&
          queue.length > 1
        ) {
          const dropped = queue.shift();
          if (dropped !== undefined) {
            replayDrainQueueBytesRef.current -= utf8ByteLength(dropped);
          }
        }
        return;
      }
      termRef.current?.write(chunk);
    },
    [termRef],
  );

  const onReplaySnapshot = useCallback(
    (info: {
      data: string;
      cols: number;
      rows: number;
      terminalVersion: string;
    }): void => {
      const term = termRef.current;
      if (!term) return;
      // Best-effort version-family check (server's gate is authoritative).
      try {
        const major = info.terminalVersion.split(".")[0];
        if (major && major !== "6") {
          // eslint-disable-next-line no-console
          console.warn(
            `[terminal] replay_snapshot served by xterm major ${major}; client xterm.js is major 6 — visual artifacts possible`,
          );
        }
      } catch {
        /* ignore */
      }
      replayGenerationRef.current += 1;
      const generation = replayGenerationRef.current;
      clearReplayWatchdog();
      replayDrainQueueRef.current = [];
      replayDrainQueueBytesRef.current = 0;
      replaySnapshotInFlightRef.current = true;
      replayWatchdogRef.current = setTimeout(() => {
        replayWatchdogRef.current = null;
        settleReplayGate(generation, term);
      }, REPLAY_DRAIN_TIMEOUT_MS);
      try {
        try {
          term.reset();
        } catch {
          /* xterm mid-dispose; ignore */
        }
        // Root cause (iterate-2026-06-15-terminal-readonly-reflow): the
        // cell-state snapshot is serialized at the WRITER's width (the live
        // mirror's cols — ADR-087/088). A read-only reader whose terminal was
        // fit to a NARROWER viewport (e.g. a phone) was writing that wider
        // snapshot into the narrow terminal, so @xterm/addon-serialize's
        // absolute cursor moves (CHA/CUP) clamped/wrapped at the wrong column
        // → character-level interleaving ("Dein vom" → "De invom"). Size the
        // terminal to the snapshot's own dims BEFORE the write so it
        // reconstructs faithfully; the reader's own resize is writer-gated
        // server-side, so this never shrinks the writer's pty.
        if (
          (info.cols > 0 && info.cols !== term.cols) ||
          (info.rows > 0 && info.rows !== term.rows)
        ) {
          try {
            term.resize(info.cols, info.rows);
          } catch {
            /* invalid dims / mid-dispose — proceed with the write anyway */
          }
        }
        term.write(info.data, () => {
          settleReplayGate(generation, term);
        });
      } catch (err) {
        // AC-3: synchronous throw → release the gate + DROP queue (do
        // NOT drain onto a terminal whose snapshot write just failed).
        resetGate();
        // eslint-disable-next-line no-console
        console.warn(
          `[terminal] replay_snapshot write failed: ${(err as Error).message}`,
        );
      }
    },
    [clearReplayWatchdog, resetGate, settleReplayGate, termRef],
  );

  // Memoize the handle so useAutoLaunch's taskId-reset effect doesn't fire
  // on every shell render (the dep array sees a fresh object identity
  // otherwise — which silently resets `launchInjectedThisPtyLifetimeRef`
  // on every render and the one-shot guard never holds).
  return useMemo<ReplayDrainGateHandle>(
    () => ({
      dataSeenInitiallyRef,
      lastPtyDataAtRef,
      onDataChunk,
      onReplaySnapshot,
      resetGate,
    }),
    [onDataChunk, onReplaySnapshot, resetGate],
  );
}
