/*
 * useReplayDrainGate — ADR-108 replay-drain gate (Campaign C / C5).
 *
 * Extracted from EmbeddedTerminal.tsx (behaviour preserved apart from the two
 * iterate-2026-07-30 items called out below):
 *   - While a `replay_snapshot` `term.write` is parsing asynchronously,
 *     queue live `data` instead of writing it — otherwise the two
 *     writers interleave and corrupt the xterm buffer (Bug B left-
 *     column glyph-fragment smear).
 *   - Drain queue on completion callback OR watchdog (5 s).
 *   - Generation counter neutralises stale callbacks / superseding
 *     snapshots.
 *   - Byte cap (8 MiB) drops OLDEST queued chunks; never force-drain. NEW: the trim
 *     ANNOUNCES itself (`onQueueOverflow`) so the caller can ask for a resync —
 *     dropping chunks silently is what DO-NOT #18 forbids. NEW: a snapshot arriving
 *     mid-write is PARKED until that write settles, so a resync cannot interleave.
 *
 * Plus prompt-readiness bookkeeping refs (`dataSeenInitiallyRef`,
 * `lastPtyDataAtRef`) shared with `useAutoLaunch`, which reads the same in-flight
 * flag for its handshake.
 */

import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

import { ReplayDrainQueue } from "./replay-drain-queue";

export const REPLAY_DRAIN_TIMEOUT_MS = 5_000;
export { REPLAY_DRAIN_MAX_BYTES } from "./replay-drain-queue";

/** Payload of a `replay_snapshot` envelope, as the gate consumes it. */
export interface ReplaySnapshotInfo {
  data: string;
  cols: number;
  rows: number;
  terminalVersion: string;
}

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
  onReplaySnapshot: (info: ReplaySnapshotInfo) => void;
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
  /**
   * Fired when the drain queue overflowed its byte cap and had to discard the
   * oldest chunks. Those bytes are unrecoverable locally, so the caller should
   * request a full-grid resync (iterate-2026-07-30, AC-6 / DO-NOT #18).
   */
  onQueueOverflow?: () => void,
): ReplayDrainGateHandle {
  const onReplaySettledRef = useRef(onReplaySettled);
  onReplaySettledRef.current = onReplaySettled;
  const onQueueOverflowRef = useRef(onQueueOverflow);
  onQueueOverflowRef.current = onQueueOverflow;
  // Snapshot parked mid-write (latest wins) + the seam settleReplayGate applies it
  // through, which avoids a declaration cycle between the two callbacks.
  const pendingSnapshotRef = useRef<ReplaySnapshotInfo | null>(null);
  const applySnapshotRef = useRef<
    ((info: ReplaySnapshotInfo, preserveQueue?: boolean) => void) | null
  >(null);
  // Gate refs.
  const replaySnapshotInFlightRef = useRef(false);
  const queueRef = useRef<ReplayDrainQueue>(new ReplayDrainQueue());
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
    queueRef.current.clear();
    // Discard a parked snapshot too — on a taskId change it belongs to the OLD task.
    pendingSnapshotRef.current = null;
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
      // A snapshot parked mid-write applies FIRST — before the queue is drained, or
      // `term.reset()` would run right after `term.write(queued)` and xterm would
      // parse those just-pushed bytes onto the grid the snapshot is about to paint.
      // The queue is handed over untouched: it holds only data that arrived AFTER
      // that grid (older deltas were dropped at park time), so it must land on top.
      // Always cleared, even when unusable: a parked grid that outlived its terminal
      // would otherwise be restored into the NEXT task and smeared over.
      const parked = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
      if (parked && !disposedRef.current && termRef.current === term) {
        applySnapshotRef.current?.(parked, true);
        return; // the parked snapshot's own settle drains the queue + converges
      }
      const queued = queueRef.current.takeAll();
      if (disposedRef.current || termRef.current !== term) return;
      try {
        if (queued.length > 0) term.write(queued);
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
        // A trim means bytes were DROPPED — announce it so the caller can ask for a
        // full-grid resync. Silent dropping is what DO-NOT #18 forbids; the trim
        // itself stays, because force-draining mid-flight re-creates the Bug B smear.
        if (queueRef.current.push(chunk)) onQueueOverflowRef.current?.();
        return;
      }
      termRef.current?.write(chunk);
    },
    [termRef],
  );

  const applySnapshot = useCallback(
    (info: ReplaySnapshotInfo, preserveQueue = false): void => {
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
      if (!preserveQueue) queueRef.current.clear();
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
  applySnapshotRef.current = applySnapshot;

  /** Park a snapshot arriving mid-write (latest wins): `term.reset()` is SYNCHRONOUS,
   *  so resetting now would let the earlier write's still-queued bytes land on the
   *  newer grid (external review). Deltas queued BEFORE the new grid are dropped
   *  here — the grid supersedes them — while anything arriving after it queues
   *  normally and is drained once the parked snapshot settles. */
  const onReplaySnapshot = useCallback(
    (info: ReplaySnapshotInfo): void => {
      if (replaySnapshotInFlightRef.current) {
        pendingSnapshotRef.current = info;
        queueRef.current.clear();
        return;
      }
      applySnapshot(info);
    },
    [applySnapshot],
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
