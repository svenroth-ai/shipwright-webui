/*
 * useTerminalBannerState — the shell-owned banner state cluster for
 * EmbeddedTerminal (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * Extracted from `EmbeddedTerminal.tsx` to keep it under its anti-ratchet
 * ceiling, and because these four pieces are one concern: which banner strips
 * the terminal frame is currently showing. The grace-arming EFFECTS live in
 * `useTerminalShellEffects` (they need the socket); this hook owns only the
 * state and the per-task reset.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface TerminalBannerState {
  readOnlyArmed: boolean;
  setReadOnlyArmed: Dispatch<SetStateAction<boolean>>;
  reconnectingArmed: boolean;
  setReconnectingArmed: Dispatch<SetStateAction<boolean>>;
  resetBannerDismissed: boolean;
  setResetBannerDismissed: Dispatch<SetStateAction<boolean>>;
}

export function useTerminalBannerState(
  taskId: string,
  taskState?: string,
): TerminalBannerState {
  const [readOnlyArmed, setReadOnlyArmed] = useState(false);
  const [reconnectingArmed, setReconnectingArmed] = useState(false);
  const [resetBannerDismissed, setResetBannerDismissed] = useState(false);

  // A dismissal belongs to the task it was made on.
  useEffect(() => {
    setResetBannerDismissed(false);
  }, [taskId]);

  // doubt-reviewer (MEDIUM, third pass) — a dismissal also belongs to the
  // pty lifetime it was made on. Reopen (done -> non-done) reconnects the
  // socket (Bug B's own fix) and can genuinely re-report `terminalReset`
  // for a NEW reset (e.g. the pty was reaped while closed), but without
  // this the earlier dismissal silently suppresses that new banner for
  // the rest of the mounted instance's life. Same edge as useAutoLaunch's
  // Reopen re-arm — including doubt-reviewer's 6th-pass amendment: mirror
  // `sessionEnded`'s OR check (EmbeddedTerminal.tsx) so a Retry
  // (launch_failed -> active) re-arms too, not just Reopen (done -> ...).
  const prevTaskStateRef = useRef(taskState);
  useEffect(() => {
    const prev = prevTaskStateRef.current;
    prevTaskStateRef.current = taskState;
    const wasEnded = prev === "done" || prev === "launch_failed";
    const isEnded = taskState === "done" || taskState === "launch_failed";
    if (wasEnded && !isEnded) {
      setResetBannerDismissed(false);
    }
  }, [taskState]);

  return {
    readOnlyArmed,
    setReadOnlyArmed,
    reconnectingArmed,
    setReconnectingArmed,
    resetBannerDismissed,
    setResetBannerDismissed,
  };
}
