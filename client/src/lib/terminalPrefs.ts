/*
 * Client-local terminal preferences (per-browser, localStorage).
 *
 * iterate-2026-06-30-terminal-paste-single-sink — copy-on-selection
 * (auto-copy a mouse selection straight to the OS clipboard) silently
 * CLOBBERED the user's clipboard right before a right-click paste: you
 * copy something elsewhere, accidentally select terminal text, and the
 * selection overwrites what you were about to paste. With Windows
 * Clipboard History (Win+V) on, the previous entry resurfaces and feels
 * like a "double paste".
 *
 * It is now OPT-IN, default OFF (VS Code parity:
 * `terminal.integrated.copyOnSelection` defaults false). Explicit
 * Ctrl+C / Ctrl+Insert copy (terminal-clipboard.ts) is unaffected.
 *
 * Stored client-side (NOT GlobalSettings) because it is a per-browser UI
 * preference. Reads are LIVE (each selection flush re-reads via
 * `getCopyOnSelection()`), so the Settings toggle takes effect on an
 * already-open terminal with no remount or storage-event plumbing.
 */

export const COPY_ON_SELECTION_KEY = "shipwright.terminal.copyOnSelection";

/** Read the live preference. Defaults to `false` (off) and on any error. */
export function getCopyOnSelection(): boolean {
  try {
    return localStorage.getItem(COPY_ON_SELECTION_KEY) === "true";
  } catch {
    // Private-mode / disabled storage — treat as the safe default.
    return false;
  }
}

/** Persist the preference. Non-fatal if storage is unavailable. */
export function setCopyOnSelection(enabled: boolean): void {
  try {
    localStorage.setItem(COPY_ON_SELECTION_KEY, enabled ? "true" : "false");
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}
