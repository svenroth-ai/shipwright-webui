/*
 * useKeyboardMap — the global keyboard binder (A21, FR-01.65).
 *
 * OWNS THE INERT-WHEN-TYPING RULE (the fence — AC1, load-bearing). The
 * task-detail screen hosts a LIVE pty; a global keydown that swallows a
 * letter while the terminal has focus changes the bytes reaching the pty.
 * `isTypingContext()` is the single predicate — the list-nav hook and the
 * task-detail `t`/Esc handler import it from here so there is ONE fence.
 *
 * This hook binds only the TRULY global chords:
 *   - Ctrl/⌘+K → open the command palette   (AC4)
 *   - ?        → open the keyboard cheat-sheet (AC4)
 * Per-surface bindings (j/k list nav, `t` terminal focus, quick actions) live
 * in their surfaces and gate on the SAME `isTypingContext()` predicate.
 *
 * Fence rules (never violated):
 *   - No global chord fires when focus is inside the xterm host, an
 *     input/textarea/select, a contenteditable, or an open dialog.
 *   - No global chord fires during IME composition (event.isComposing).
 *   - preventDefault() is called ONLY for a key we actually handle — an
 *     unhandled key is left completely untouched (AC1).
 *   - Even the palette open chord (Ctrl/⌘+K) is INERT inside the terminal, so
 *     ^K passes through to the pty byte-identical to main (byte-path guard).
 *     A clickable palette trigger (CommandCenter) is the non-terminal path.
 */

import { useEffect } from "react";

/** Selector for the embedded-terminal host + xterm's own DOM. */
const TERMINAL_SELECTOR =
  '[data-testid="embedded-terminal"], .xterm, .xterm-helper-textarea, .xterm-screen';

/**
 * True when the given element (or the current focus) sits inside a context
 * where a global keystroke must be left alone: text entry, the embedded
 * terminal, or an open dialog. Exported so every keyboard surface shares ONE
 * fence.
 */
export function isTypingContext(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : typeof document !== "undefined"
        ? document.activeElement
        : null;
  if (!el || !(el instanceof Element)) return false;

  // Text-entry tags.
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  // Contenteditable (walks up: the caret may be in a child span).
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el.closest('[contenteditable="true"], [contenteditable=""]')) return true;

  // The embedded terminal — the load-bearing case.
  if (el.closest(TERMINAL_SELECTOR)) return true;

  // Any open dialog (the palette, the cheat-sheet, a modal). The palette owns
  // its own key handling internally; the global map stays out of its way.
  if (el.closest('[role="dialog"]')) return true;

  return false;
}

export interface KeyboardMapHandlers {
  onOpenPalette?: () => void;
  onOpenShortcuts?: () => void;
  /** Default true. When false the binder is dormant (no listener effects). */
  enabled?: boolean;
}

/** Does this keydown request the command palette (Ctrl on Win/Linux, ⌘ on Mac)? */
function isPaletteChord(ev: KeyboardEvent): boolean {
  return (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "k";
}

/** Does this keydown request the cheat-sheet? `?` (Shift+/ on most layouts). */
function isShortcutsChord(ev: KeyboardEvent): boolean {
  return !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key === "?";
}

export function useKeyboardMap(handlers: KeyboardMapHandlers): void {
  const { onOpenPalette, onOpenShortcuts, enabled = true } = handlers;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const handler = (ev: KeyboardEvent) => {
      // IME first — a composing keystroke is never a shortcut.
      if (ev.isComposing) return;
      // THE FENCE: never act (and never preventDefault) inside a typing context.
      if (isTypingContext(ev.target)) return;

      if (isPaletteChord(ev)) {
        if (onOpenPalette) {
          ev.preventDefault();
          onOpenPalette();
        }
        return;
      }
      if (isShortcutsChord(ev)) {
        if (onOpenShortcuts) {
          ev.preventDefault();
          onOpenShortcuts();
        }
        return;
      }
      // Any other key: leave it completely untouched (no preventDefault).
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onOpenPalette, onOpenShortcuts]);
}
