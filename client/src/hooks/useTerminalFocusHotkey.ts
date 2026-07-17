/*
 * useTerminalFocusHotkey — the `t` / Esc terminal focus-mode binding for the
 * task detail (A21, FR-01.65, AC4/AC5). Task-detail-scoped (only mounted on the
 * page), sharing the SAME fence as the global map so it is inert inside the
 * terminal / text entry — while the terminal has focus, `t` and Esc reach the
 * pty (byte-identical to main), which is exactly why `t` can only ENTER focus
 * mode from outside the terminal.
 *
 * Enter/leave go through the EXISTING A18 maximize control (the `terminal-
 * maximize` button) — clicking it runs useThreePaneLayout's collapse→resize
 * path, which fires the pty resize. NO parallel hide path (AC5), no new
 * layout state.
 */

import { useEffect } from "react";
import { isTypingContext } from "./useKeyboardMap";

const MAXIMIZE_SELECTOR = '[data-testid="terminal-maximize"]';

interface Options {
  /** Surface the terminal (Files tab + Terminal sub-tab) and focus xterm. */
  focusTerminal: () => void;
  enabled?: boolean;
}

export function useTerminalFocusHotkey({ focusTerminal, enabled = true }: Options): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const maximizeBtn = () =>
      document.querySelector<HTMLButtonElement>(MAXIMIZE_SELECTOR);
    const isMaxed = () => maximizeBtn()?.getAttribute("aria-pressed") === "true";

    const handler = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // THE FENCE — inside the terminal, `t`/Esc are the pty's (Claude's).
      if (ev.isComposing || isTypingContext(ev.target)) return;

      const key = ev.key.toLowerCase();
      if (key === "t") {
        ev.preventDefault();
        // Surface + focus the terminal first, then ENTER focus mode via the
        // existing maximize toggle (idempotent — don't toggle back off).
        focusTerminal();
        if (!isMaxed()) maximizeBtn()?.click();
      } else if (ev.key === "Escape") {
        // Only act when we're actually in focus mode — otherwise leave Esc for
        // whoever else wants it (no preventDefault of an unhandled key).
        if (isMaxed()) {
          ev.preventDefault();
          maximizeBtn()?.click();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, focusTerminal]);
}
