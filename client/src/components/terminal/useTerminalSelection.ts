/*
 * terminal-selection — VS Code-parity selection UX (Campaign C / C5).
 *
 * Extracted from EmbeddedTerminal.tsx. Imperative attach helper, NOT a
 * React hook — selection wiring depends on the xterm being open (real
 * `term.element` available), which happens inside the shell's mount-
 * effect. A hook called at the top of the function body would run with
 * `term.element == null` and miss the attach window.
 *
 * Behaviour bit-perfect:
 *   - `onSelectionChange` tracks the current xterm selection in a ref
 *     (NOT React state — fires per cell during a drag, would cause N
 *     re-renders per drag; Plan-review gemini #3 MED).
 *   - Native `mouseup` / `keyup` on `document` flush the latest tracked
 *     value to the OS clipboard via `copyText` — inside the trusted
 *     user-activation window.
 *   - Drag-origin tracker (`dragStartedInTerminalRef`): mousedown inside
 *     the terminal arms; the matching mouseup (anywhere) flushes the
 *     copy; outside-mousedown clears the flag (no stale carryover).
 *   - keyup gate narrowed to Shift + Arrow/Home/End/Page only (external-
 *     review code-mode round 4 MED #2).
 *   - Dedup via `lastCopiedSelectionRef`; resets on empty selection so
 *     re-selecting same text after a clear copies again.
 *   - Mouse-mode banner: `MutationObserver` on `term.element` class list;
 *     synchronous initial-state-sync read (external-review MED-7);
 *     off→on transition re-arms a previously dismissed banner.
 */

import type { Terminal } from "@xterm/xterm";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { copyText } from "../../lib/clipboard";

export interface AttachTerminalSelectionOptions {
  /** Mounted xterm (open()-ed; `term.element` populated). */
  term: Terminal;
  /** True once cleanup nulled the term refs. Read at every callback fire. */
  disposedRef: RefObject<boolean>;
  /** Mouse-mode banner state setter. */
  setMouseEventsActive: Dispatch<SetStateAction<boolean>>;
  /** Dismissal flip — off→on re-arms a previously dismissed banner. */
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
}

/**
 * Attach selection + mouse-mode listeners to an open xterm. Returns a
 * disposer that removes the document listeners, disconnects the
 * MutationObserver, and unbinds `onSelectionChange`.
 *
 * Idempotent contract — same as the source mount-effect's cleanup path.
 */
export function attachTerminalSelection(
  opts: AttachTerminalSelectionOptions,
): () => void {
  const { term, disposedRef, setMouseEventsActive, setBannerDismissed } = opts;
  const termElement = term.element;
  if (!termElement) {
    // term.open() hasn't run yet — caller misuse. Return a no-op disposer
    // so the shell's cleanup chain still works.
    return () => {};
  }

  // Ephemeral selection refs — module-local closure, NO React state.
  const state = {
    latestSelection: "",
    lastCopiedSelection: "",
    dragStartedInTerminal: false,
  };

  const selectionDisposable = term.onSelectionChange(() => {
    if (disposedRef.current) return;
    try {
      const sel = term.getSelection();
      state.latestSelection = sel;
      if (!sel || sel.trim().length === 0) {
        state.lastCopiedSelection = "";
      }
    } catch {
      /* term may be mid-dispose; ignore */
    }
  });

  const onTerminalMousedown = (event: Event): void => {
    const target = event.target as Node | null;
    state.dragStartedInTerminal = !!(target && termElement.contains(target));
  };

  const flushSelectionCopy = (event: Event): void => {
    if (disposedRef.current) return;
    if (event.type === "mouseup") {
      if (!state.dragStartedInTerminal) {
        const target = event.target as Node | null;
        if (!target || !termElement.contains(target)) return;
      }
      state.dragStartedInTerminal = false;
    } else if (event.type === "keyup") {
      const ke = event as KeyboardEvent;
      if (!ke.shiftKey) return;
      if (!/^(Arrow|Home|End|Page)/.test(ke.key)) return;
      const active = document.activeElement;
      if (!active || !termElement.contains(active)) return;
    }
    let raw = "";
    try {
      if (term.hasSelection()) raw = term.getSelection();
    } catch {
      /* term mid-dispose */
    }
    if (!raw) raw = state.latestSelection;
    if (!raw || raw.trim().length === 0) return;
    if (raw === state.lastCopiedSelection) return;
    state.lastCopiedSelection = raw;
    void copyText(raw).catch(() => {
      /* silent — explicit Ctrl+C is the retry path */
    });
  };

  document.addEventListener("mousedown", onTerminalMousedown);
  document.addEventListener("mouseup", flushSelectionCopy);
  document.addEventListener("keyup", flushSelectionCopy);

  // Initial sync read — terminal mounted ALREADY in mouse mode shows
  // the banner immediately (external-review MED-7).
  const initialActive = termElement.classList.contains("enable-mouse-events");
  if (initialActive) {
    setMouseEventsActive(true);
    setBannerDismissed(false);
  }
  const observer = new MutationObserver(() => {
    if (disposedRef.current) return;
    const active = termElement.classList.contains("enable-mouse-events");
    setMouseEventsActive((prev) => {
      if (active && !prev) {
        setBannerDismissed(false);
      }
      return active;
    });
  });
  observer.observe(termElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => {
    try {
      selectionDisposable.dispose();
    } catch {
      /* best-effort */
    }
    document.removeEventListener("mousedown", onTerminalMousedown);
    document.removeEventListener("mouseup", flushSelectionCopy);
    document.removeEventListener("keyup", flushSelectionCopy);
    observer.disconnect();
  };
}
