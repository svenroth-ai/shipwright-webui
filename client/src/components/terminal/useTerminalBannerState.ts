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

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export interface TerminalBannerState {
  readOnlyArmed: boolean;
  setReadOnlyArmed: Dispatch<SetStateAction<boolean>>;
  reconnectingArmed: boolean;
  setReconnectingArmed: Dispatch<SetStateAction<boolean>>;
  resetBannerDismissed: boolean;
  setResetBannerDismissed: Dispatch<SetStateAction<boolean>>;
}

export function useTerminalBannerState(taskId: string): TerminalBannerState {
  const [readOnlyArmed, setReadOnlyArmed] = useState(false);
  const [reconnectingArmed, setReconnectingArmed] = useState(false);
  const [resetBannerDismissed, setResetBannerDismissed] = useState(false);

  // A dismissal belongs to the task it was made on.
  useEffect(() => {
    setResetBannerDismissed(false);
  }, [taskId]);

  return {
    readOnlyArmed,
    setReadOnlyArmed,
    reconnectingArmed,
    setReconnectingArmed,
    resetBannerDismissed,
    setResetBannerDismissed,
  };
}
