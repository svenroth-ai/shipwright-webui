/*
 * LaunchCoordinatorContext — auto-launch flow coordination (ADR-068-A1).
 *
 * Replaces the `window.dispatchEvent("webui:launch-copied")` pattern from
 * ADR-067. The context is scoped to TaskDetailPage and provides three
 * operations:
 *
 *   - dispatchAutoLaunch(commands, resume)   →  monotonic launchToken
 *   - consumeLaunch(token)                   →  EmbeddedTerminal calls
 *                                              this after sending bytes
 *   - cancelLaunch(reason)                   →  3 deterministic paths:
 *                                              role-not-writer, page-unmount,
 *                                              30s timeout
 *
 * The pendingLaunch state carries the three-shell-form copy commands +
 * resume flag; EmbeddedTerminal picks the shellKind matching the WS
 * ready handshake. CTA components disable while
 * `pendingLaunch !== null` (rapid-click queue depth = 1).
 *
 * For consumers OUTSIDE a TaskDetailPage tree (TaskBoardPage, tests
 * without a provider), the default no-op implementation lets components
 * call coord methods safely without crashing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export interface CopyCommandForms {
  powershell: string;
  cmd: string;
  posix: string;
}

export interface PendingLaunch {
  /** Monotonic, increments on every dispatchAutoLaunch — dedup mark. */
  launchToken: number;
  commands: CopyCommandForms;
  resume: boolean;
  /** Wall-clock ms when the pending entry expires (default 30s from dispatch). */
  expiresAt: number;
}

export type CancelReason =
  | "role-not-writer"
  | "page-unmount"
  | "timeout"
  | "user"
  | "consumed";

export interface LaunchCoordinator {
  pendingLaunch: PendingLaunch | null;
  dispatchAutoLaunch: (commands: CopyCommandForms, resume: boolean) => number;
  consumeLaunch: (token: number) => void;
  cancelLaunch: (reason: CancelReason) => void;
  /** Last cancel reason (for diagnostics + tooltip surfaces). */
  lastCancelReason: CancelReason | null;
}

const NO_OP_COORDINATOR: LaunchCoordinator = {
  pendingLaunch: null,
  dispatchAutoLaunch: () => 0,
  consumeLaunch: () => undefined,
  cancelLaunch: () => undefined,
  lastCancelReason: null,
};

const LaunchCoordinatorCtx = createContext<LaunchCoordinator>(NO_OP_COORDINATOR);

export function useLaunchCoordinator(): LaunchCoordinator {
  return useContext(LaunchCoordinatorCtx);
}

export interface LaunchCoordinatorProviderProps {
  children: ReactNode;
  /**
   * Pending-launch lifetime ceiling. After this many ms, an unconsumed
   * pending entry is auto-cancelled with reason "timeout" and the CTA
   * re-enables. Default 30s — tuned to cover slow shell boots
   * (200-2000 ms .bashrc / $PROFILE) plus a comfortable margin.
   */
  pendingTimeoutMs?: number;
}

export function LaunchCoordinatorProvider({
  children,
  pendingTimeoutMs = 30_000,
}: LaunchCoordinatorProviderProps) {
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
  const [lastCancelReason, setLastCancelReason] = useState<CancelReason | null>(null);
  const tokenRef = useRef(0);

  const dispatchAutoLaunch = useCallback(
    (commands: CopyCommandForms, resume: boolean): number => {
      tokenRef.current += 1;
      const token = tokenRef.current;
      setPendingLaunch({
        launchToken: token,
        commands,
        resume,
        expiresAt: Date.now() + pendingTimeoutMs,
      });
      return token;
    },
    [pendingTimeoutMs],
  );

  const consumeLaunch = useCallback((token: number) => {
    setPendingLaunch((prev) => {
      if (!prev || prev.launchToken !== token) return prev;
      return null;
    });
    setLastCancelReason("consumed");
  }, []);

  const cancelLaunch = useCallback((reason: CancelReason) => {
    setPendingLaunch(null);
    setLastCancelReason(reason);
  }, []);

  // Auto-cancel when the pending entry expires.
  useEffect(() => {
    if (!pendingLaunch) return;
    const remaining = pendingLaunch.expiresAt - Date.now();
    if (remaining <= 0) {
      cancelLaunch("timeout");
      return;
    }
    const t = setTimeout(() => cancelLaunch("timeout"), remaining);
    return () => clearTimeout(t);
  }, [pendingLaunch, cancelLaunch]);

  const value = useMemo<LaunchCoordinator>(
    () => ({
      pendingLaunch,
      dispatchAutoLaunch,
      consumeLaunch,
      cancelLaunch,
      lastCancelReason,
    }),
    [pendingLaunch, dispatchAutoLaunch, consumeLaunch, cancelLaunch, lastCancelReason],
  );

  return (
    <LaunchCoordinatorCtx.Provider value={value}>
      {children}
    </LaunchCoordinatorCtx.Provider>
  );
}
