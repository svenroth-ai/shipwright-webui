/*
 * useAutoLaunch — ADR-068-A1 auto-launch + lifecycle guard.
 *
 * Extracted from EmbeddedTerminal.tsx (Campaign C / C5). Owns the
 * launch-side state: the one-shot auto-inject guard (FIRST launch into a
 * fresh pty auto-injects, SECOND parks behind explicit "Send to terminal"
 * confirm), the reused-pty guard (re-armed by `ptyReused`/`terminalReset`
 * so a post-reload launch can't auto-inject into a still-running Claude
 * session), the prompt-readiness handshake (250 ms quiesce after first
 * data byte OR 1500 ms silence grace OR 15 s hard cap → cancel), and
 * manual-send confirm. Reads the gate's bookkeeping refs from
 * `useReplayDrainGate` (Plan-review openai #3 HIGH).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CopyCommandForms,
  LaunchCoordinator,
} from "../../contexts/LaunchCoordinatorContext";
import type { UseTerminalSocketResult } from "../../hooks/useTerminalSocket";
import type { ReplayDrainGateHandle } from "./useReplayDrainGate";

// Prompt-readiness handshake constants (Decision #12, source unchanged).
const PROMPT_QUIESCE_MS = 250;
const PROMPT_READY_NO_DATA_GRACE_MS = 1500;
const PROMPT_HARD_CAP_MS = 15_000;
const PROMPT_POLL_MS = 50;

type CoordLike = Pick<
  LaunchCoordinator,
  "pendingLaunch" | "consumeLaunch" | "cancelLaunch"
>;
type SocketLike = Pick<
  UseTerminalSocketResult,
  "ready" | "role" | "shellKind" | "send" | "terminalReset" | "ptyReused" | "replayOnly"
>;
type ShellKind = NonNullable<SocketLike["shellKind"]>;

export interface UseAutoLaunchOptions {
  /** Active task — reset triggers on every change (different pty). */
  taskId: string;
  /**
   * The task's lifecycle state (iterate-2026-08-16-task-lifecycle-ux-fixes).
   * A `done` -> non-`done` transition (Re-open) re-arms the one-shot guard,
   * mirroring the `terminalReset` re-arm below — see the doc comment on
   * `EmbeddedTerminalProps.taskState` for the full "why".
   */
  taskState?: string;
  /** WS facade. */
  socket: SocketLike;
  /** Launch coordinator (`useLaunchCoordinator()` result). */
  coord: CoordLike;
  /** Replay-drain gate — supplies prompt-readiness refs + reset. */
  gate: ReplayDrainGateHandle;
  /**
   * Fired synchronously IMMEDIATELY before the launch command data-frame is
   * written to the pty (both auto-inject + manual-send paths); fits + emits
   * a `resize` so the pty is at the client's REAL cols/rows before Claude
   * renders its width-sensitive title-pill banner (closes iterate-2026-07-
   * 01-terminal-title-wrap-smear: "Der" → "D er").
   */
  onBeforeDispatch?: () => boolean | void;
  /** False while a force-mounted terminal is hidden and cannot be sized. */
  dispatchReady?: boolean;
}

export interface UseAutoLaunchResult {
  manualSendCommand: string | null;
  previewCommand: string | null;
  handleManualSend: () => void;
  dismissManualSend: () => void;
}

export function useAutoLaunch(opts: UseAutoLaunchOptions): UseAutoLaunchResult {
  const { taskId, taskState, socket, coord, gate, onBeforeDispatch, dispatchReady = true } = opts;

  // Latest-ref so the async auto-inject closure never captures a stale
  // callback across parent re-renders (same pattern as socketSend in
  // useTerminalResize).
  const onBeforeDispatchRef = useRef(onBeforeDispatch);
  onBeforeDispatchRef.current = onBeforeDispatch;

  const consumedTokensRef = useRef<Set<number>>(new Set());
  const injectionInFlightRef = useRef(false);
  const launchInjectedThisPtyLifetimeRef = useRef(false);
  const ptyReusedGuardEvaluatedRef = useRef(false);

  const [manualSendPending, setManualSendPending] = useState<
    { commands: CopyCommandForms } | null
  >(null);

  // Task-change reset — different task = different pty. Narrow dep list:
  // depend ONLY on taskId, `gate.*Ref`s are stable RefObjects independent
  // of `gate` object identity (memoized in useReplayDrainGate).
  //
  // Does NOT call `gate.resetGate()` (code-reviewer HIGH, re-verifying the
  // 9th finding): `EmbeddedTerminal`'s xterm mount-effect has an empty dep
  // array and no call site keys it by `taskId`, so navigation between
  // tasks does NOT remount the Terminal — an old task's still-draining
  // `replay_snapshot` write can outlive the switch, and `resetGate()`
  // would clobber it exactly as on the Reopen/terminalReset edge.
  useEffect(() => {
    consumedTokensRef.current = new Set();
    injectionInFlightRef.current = false;
    launchInjectedThisPtyLifetimeRef.current = false;
    ptyReusedGuardEvaluatedRef.current = false;
    setManualSendPending(null);
    gate.dataSeenInitiallyRef.current = false;
    gate.lastPtyDataAtRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Reused-pty arming — latched at FIRST LIVE ready per task.
  //
  // spec-reviewer (REJECT) — a replay-only ready's `ptyReused` is always
  // fabricated `false`, so it must never latch or consume this guard,
  // regardless of arrival order vs. Reopen's reset below (AC-7 race).
  useEffect(() => {
    if (!socket.ready) return;
    if (socket.replayOnly === true) return;
    if (ptyReusedGuardEvaluatedRef.current) return;
    ptyReusedGuardEvaluatedRef.current = true;
    if (socket.ptyReused === true) {
      launchInjectedThisPtyLifetimeRef.current = true;
    }
  }, [socket.ready, socket.ptyReused, socket.replayOnly]);

  // terminalReset re-arm (ADR-104). `terminalReset` is a SERVER-derived
  // "this pty is genuinely fresh" signal, unlike a raw `taskState` tick —
  // code-reviewer (MEDIUM, 7th finding) moved the reset off that tick.
  // doubt-reviewer (HIGH, 5th pass): still must NOT call `gate.resetGate()`
  // — Reopen never remounts xterm, so an OLD `replay_snapshot` write can
  // still be draining on the SAME terminal, and clobbering
  // `replaySnapshotInFlightRef` would apply the new socket's snapshot
  // immediately instead of parking it, corrupting the buffer. Only the
  // prompt-readiness refs are ours to reset here.
  useEffect(() => {
    if (socket.terminalReset === true) {
      launchInjectedThisPtyLifetimeRef.current = false;
      setManualSendPending(null);
      gate.dataSeenInitiallyRef.current = false;
      gate.lastPtyDataAtRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket.terminalReset]);

  // Re-open re-arm (iterate-2026-08-16-task-lifecycle-ux-fixes) — a `done`
  // -> non-`done` transition means "this task is live again" (⋯-menu
  // Reopen, board drag out of Done); EmbeddedTerminal stays mounted across
  // it, so without this the one-shot guard keeps whatever it last armed to.
  // doubt-reviewer (HIGH) also resets `ptyReusedGuardEvaluatedRef` (a real
  // TRUE latched long before `done` must not survive).
  const prevTaskStateRef = useRef(taskState);
  useEffect(() => {
    const prev = prevTaskStateRef.current;
    prevTaskStateRef.current = taskState;
    // doubt-reviewer (MEDIUM, 6th pass) — mirror `sessionEnded`'s OR check
    // (EmbeddedTerminal.tsx): `launch_failed` gets the same one-shot
    // replay-only contract as `done`, so Retry must re-arm too.
    const wasEnded = prev === "done" || prev === "launch_failed";
    const isEnded = taskState === "done" || taskState === "launch_failed";
    if (wasEnded && !isEnded) {
      launchInjectedThisPtyLifetimeRef.current = false;
      ptyReusedGuardEvaluatedRef.current = false;
      setManualSendPending(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskState]);

  // ADR-068-A1 auto-launch effect.
  useEffect(() => {
    const pending = coord.pendingLaunch;
    if (!pending) return;
    if (consumedTokensRef.current.has(pending.launchToken)) return;
    if (injectionInFlightRef.current) return;
    if (!socket.ready || socket.role !== "writer") return;
    if (!socket.shellKind) return;
    if (!dispatchReady) return;
    if (pending.expiresAt <= Date.now()) return;

    // One-shot guard — park behind explicit confirm.
    if (launchInjectedThisPtyLifetimeRef.current) {
      consumedTokensRef.current.add(pending.launchToken);
      setManualSendPending({ commands: pending.commands });
      coord.consumeLaunch(pending.launchToken);
      return;
    }

    let cancelled = false;
    injectionInFlightRef.current = true;

    void (async () => {
      const startWait = Date.now();
      let handshakeCleared = false;
      while (!cancelled && Date.now() - startWait < PROMPT_HARD_CAP_MS) {
        const waited = Date.now() - startWait;
        if (
          gate.dataSeenInitiallyRef.current &&
          Date.now() - gate.lastPtyDataAtRef.current >= PROMPT_QUIESCE_MS
        ) {
          handshakeCleared = true;
          break;
        }
        if (
          !gate.dataSeenInitiallyRef.current &&
          waited >= PROMPT_READY_NO_DATA_GRACE_MS
        ) {
          handshakeCleared = true;
          break;
        }
        await new Promise((r) => setTimeout(r, PROMPT_POLL_MS));
      }
      if (cancelled) return;
      if (!handshakeCleared) {
        consumedTokensRef.current.add(pending.launchToken);
        coord.cancelLaunch("timeout");
        return;
      }
      if (consumedTokensRef.current.has(pending.launchToken)) return;
      if (!socket.ready || socket.role !== "writer") return;
      if (!socket.shellKind) return;
      if (pending.expiresAt <= Date.now()) {
        consumedTokensRef.current.add(pending.launchToken);
        coord.cancelLaunch("timeout");
        return;
      }

      // Sync the pty to the client's real width BEFORE the command runs, on
      // the same ordered WS, so Claude renders the title banner at the correct
      // cols (see onBeforeDispatch doc — the "D er" title-wrap smear).
      while (!cancelled && onBeforeDispatchRef.current?.() === false) {
        if (pending.expiresAt <= Date.now()) {
          consumedTokensRef.current.add(pending.launchToken);
          coord.cancelLaunch("timeout");
          return;
        }
        await new Promise((r) => setTimeout(r, PROMPT_POLL_MS));
      }
      if (cancelled) return;
      const cmd = pickShellCommand(pending.commands, socket.shellKind);
      consumedTokensRef.current.add(pending.launchToken);
      socket.send({ type: "data", payload: cmd + "\r" });
      launchInjectedThisPtyLifetimeRef.current = true;
      coord.consumeLaunch(pending.launchToken);
    })().finally(() => {
      injectionInFlightRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [coord, socket.ready, socket.role, socket.shellKind, coord.pendingLaunch, dispatchReady, gate.dataSeenInitiallyRef, gate.lastPtyDataAtRef]);

  const handleManualSend = useCallback(() => {
    const pending = manualSendPending;
    if (!pending) return;
    if (!socket.ready || socket.role !== "writer" || !socket.shellKind) return;
    const cmd = pickShellCommand(pending.commands, socket.shellKind);
    // Same pre-dispatch width sync as the auto path (see onBeforeDispatch).
    if (onBeforeDispatchRef.current?.() === false) return;
    socket.send({ type: "data", payload: cmd + "\r" });
    setManualSendPending(null);
  }, [
    manualSendPending,
    socket.ready,
    socket.role,
    socket.shellKind,
    socket.send,
  ]);

  const dismissManualSend = useCallback(() => {
    setManualSendPending(null);
  }, []);

  const previewCommand =
    coord.pendingLaunch && socket.shellKind
      ? pickShellCommand(coord.pendingLaunch.commands, socket.shellKind)
      : null;
  const manualSendCommand =
    manualSendPending && socket.shellKind
      ? pickShellCommand(manualSendPending.commands, socket.shellKind)
      : null;

  return {
    manualSendCommand,
    previewCommand,
    handleManualSend,
    dismissManualSend,
  };
}

/** Pick the shell-appropriate launch command bytes. Shared by auto + manual. */
function pickShellCommand(forms: CopyCommandForms, shellKind: ShellKind): string {
  return shellKind === "pwsh"
    ? forms.powershell
    : shellKind === "cmd"
      ? forms.cmd
      : forms.posix;
}
