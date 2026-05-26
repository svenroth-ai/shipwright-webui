/*
 * useAutoLaunch — ADR-068-A1 auto-launch + lifecycle guard.
 *
 * Extracted from EmbeddedTerminal.tsx (Campaign C / C5).
 *
 * Owns the launch-side state: the one-shot auto-inject guard, the
 * prompt-readiness handshake, manual-send confirm, the reused-pty +
 * terminalReset lifecycle re-arms. Reads the gate's bookkeeping refs
 * from `useReplayDrainGate` so prompt-readiness lives next to the
 * `onData` writer (Plan-review openai #3 HIGH).
 *
 * Behavioural contract — bit-perfect with the source:
 *   - One-shot auto-inject guard (resume-cta-rework 2026-05-16): the
 *     FIRST launch into a fresh pty auto-injects; the SECOND parks
 *     behind explicit "Send to terminal" confirm.
 *   - Reused-pty guard (fix-resume-guard-survives-reload 2026-05-17):
 *     `ready.ptyReused === true` on the FIRST ready of a task arms
 *     the guard so a post-reload launch can't auto-inject into a
 *     still-running Claude session.
 *   - `terminalReset === true` (ADR-104) re-arms the guard.
 *   - Prompt-readiness handshake: 250 ms quiesce after first data
 *     byte OR 1500 ms silence grace OR 15 s hard cap → cancel.
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
  "ready" | "role" | "shellKind" | "send" | "terminalReset" | "ptyReused"
>;
type ShellKind = NonNullable<SocketLike["shellKind"]>;

export interface UseAutoLaunchOptions {
  /** Active task — reset triggers on every change (different pty). */
  taskId: string;
  /** WS facade. */
  socket: SocketLike;
  /** Launch coordinator (`useLaunchCoordinator()` result). */
  coord: CoordLike;
  /** Replay-drain gate — supplies prompt-readiness refs + reset. */
  gate: ReplayDrainGateHandle;
}

export interface UseAutoLaunchResult {
  manualSendCommand: string | null;
  previewCommand: string | null;
  handleManualSend: () => void;
  dismissManualSend: () => void;
}

export function useAutoLaunch(opts: UseAutoLaunchOptions): UseAutoLaunchResult {
  const { taskId, socket, coord, gate } = opts;

  const consumedTokensRef = useRef<Set<number>>(new Set());
  const injectionInFlightRef = useRef(false);
  const launchInjectedThisPtyLifetimeRef = useRef(false);
  const ptyReusedGuardEvaluatedRef = useRef(false);

  const [manualSendPending, setManualSendPending] = useState<
    { commands: CopyCommandForms } | null
  >(null);

  // Task-change reset — different task = different pty. Narrow dep list:
  // depend ONLY on taskId so a fresh `gate` object identity per render
  // can't silently reset the one-shot guard. `gate.*Ref` are stable
  // RefObjects independent of `gate` object identity (memoized in
  // useReplayDrainGate); accessing them inside the effect is safe.
  useEffect(() => {
    consumedTokensRef.current = new Set();
    injectionInFlightRef.current = false;
    launchInjectedThisPtyLifetimeRef.current = false;
    ptyReusedGuardEvaluatedRef.current = false;
    setManualSendPending(null);
    gate.resetGate();
    gate.dataSeenInitiallyRef.current = false;
    gate.lastPtyDataAtRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Reused-pty arming — latched at FIRST ready per task.
  useEffect(() => {
    if (!socket.ready) return;
    if (ptyReusedGuardEvaluatedRef.current) return;
    ptyReusedGuardEvaluatedRef.current = true;
    if (socket.ptyReused === true) {
      launchInjectedThisPtyLifetimeRef.current = true;
    }
  }, [socket.ready, socket.ptyReused]);

  // terminalReset re-arm (ADR-104).
  useEffect(() => {
    if (socket.terminalReset === true) {
      launchInjectedThisPtyLifetimeRef.current = false;
      setManualSendPending(null);
    }
  }, [socket.terminalReset]);

  // ADR-068-A1 auto-launch effect.
  useEffect(() => {
    const pending = coord.pendingLaunch;
    if (!pending) return;
    if (consumedTokensRef.current.has(pending.launchToken)) return;
    if (injectionInFlightRef.current) return;
    if (!socket.ready || socket.role !== "writer") return;
    if (!socket.shellKind) return;
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
  }, [coord, socket.ready, socket.role, socket.shellKind, coord.pendingLaunch, gate.dataSeenInitiallyRef, gate.lastPtyDataAtRef]);

  const handleManualSend = useCallback(() => {
    const pending = manualSendPending;
    if (!pending) return;
    if (!socket.ready || socket.role !== "writer" || !socket.shellKind) return;
    const cmd = pickShellCommand(pending.commands, socket.shellKind);
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
