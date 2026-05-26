/*
 * useTerminalShellEffects — small composite hook for the shell's
 * banner-grace + tab-auto-focus + ready/meta parent-callback effects
 * (Campaign C / C5).
 *
 * Extracted purely to keep `EmbeddedTerminal.tsx` ≤300 LOC. Behaviour
 * bit-perfect with the source EmbeddedTerminal:
 *   - Read-only banner grace (ADR-084): 1500 ms after a rising-edge
 *     `socket.ready`, arm the banner if role still reader.
 *   - Tab auto-focus (iterate-2026-05-23): one-shot focus + refit +
 *     refresh on `active && socket.ready`; re-arms on `active=false`.
 *   - Surface ready/role + meta to parent callbacks.
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { safeFit } from "./useTerminalResize";
import type {
  TerminalRole,
  UseTerminalSocketResult,
} from "../../hooks/useTerminalSocket";

const READONLY_BANNER_GRACE_MS = 1500;

export interface UseTerminalShellEffectsOptions {
  socket: UseTerminalSocketResult;
  active: boolean;
  termRef: RefObject<Terminal | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  disposedRef: RefObject<boolean>;
  setReadOnlyArmed: Dispatch<SetStateAction<boolean>>;
  onReadyChange?: (ready: boolean, role: TerminalRole | null) => void;
  onTerminalMeta?: (meta: {
    replayOnly: boolean | null;
    scrollbackBytes: number | null;
    retentionDays: number | null;
    scrollbackDir: string | null;
  }) => void;
}

export function useTerminalShellEffects(
  opts: UseTerminalShellEffectsOptions,
): void {
  const {
    socket,
    active,
    termRef,
    fitAddonRef,
    disposedRef,
    setReadOnlyArmed,
    onReadyChange,
    onTerminalMeta,
  } = opts;

  // Read-only banner grace (ADR-084) — rising-edge reset.
  const prevReadyRef = useRef(false);
  useEffect(() => {
    if (socket.ready && !prevReadyRef.current) setReadOnlyArmed(false);
    prevReadyRef.current = socket.ready;
  }, [socket.ready, setReadOnlyArmed]);
  useEffect(() => {
    if (!socket.ready || socket.role !== "reader") {
      setReadOnlyArmed(false);
      return;
    }
    const t = setTimeout(
      () => setReadOnlyArmed(true),
      READONLY_BANNER_GRACE_MS,
    );
    return () => clearTimeout(t);
  }, [socket.role, socket.ready, setReadOnlyArmed]);

  // Tab auto-focus + display:none-repair refit (iterate-2026-05-23).
  const tabAutoFocusedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      tabAutoFocusedRef.current = false;
      return;
    }
    if (!socket.ready || tabAutoFocusedRef.current) return;
    tabAutoFocusedRef.current = true;
    const t = setTimeout(() => {
      if (disposedRef.current) return;
      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (term && fit) {
        safeFit(fit, term, disposedRef.current);
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* term mid-dispose */
        }
      }
      try {
        term?.focus();
      } catch {
        /* term mid-dispose */
      }
    }, 0);
    return () => clearTimeout(t);
    // termRef/fitAddonRef/disposedRef are stable RefObjects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, socket.ready]);

  // Surface ready + meta to parent.
  useEffect(() => {
    onReadyChange?.(socket.ready, socket.role);
  }, [socket.ready, socket.role, onReadyChange]);
  useEffect(() => {
    onTerminalMeta?.({
      replayOnly: socket.replayOnly,
      scrollbackBytes: socket.scrollbackBytes,
      retentionDays: socket.retentionDays,
      scrollbackDir: socket.scrollbackDir,
    });
  }, [
    socket.replayOnly,
    socket.scrollbackBytes,
    socket.retentionDays,
    socket.scrollbackDir,
    onTerminalMeta,
  ]);
}
