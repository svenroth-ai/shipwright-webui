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
import { getCopyOnSelection } from "../../lib/terminalPrefs";

export interface AttachTerminalSelectionOptions {
  /** Mounted xterm (open()-ed; `term.element` populated). */
  term: Terminal;
  /** True once cleanup nulled the term refs. Read at every callback fire. */
  disposedRef: RefObject<boolean>;
  /** Mouse-mode banner state setter. */
  setMouseEventsActive: Dispatch<SetStateAction<boolean>>;
  /** Dismissal flip — off→on re-arms a previously dismissed banner. */
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
  /**
   * Capture the settled selection into the redraw-proof copy cache
   * (iterate-2026-07-06-terminal-copy-selection-cache). Fired at selection
   * settle (mouseup / shift-select keyup) REGARDLESS of the copy-on-selection
   * preference — capturing is NOT a clipboard write, so it never clobbers the
   * OS clipboard. Optional.
   */
  captureSelection?: (text: string) => void;
  /**
   * Invalidate the copy cache + Copy pill: a fresh selection gesture
   * (mousedown in the terminal) or committing keyboard input. Keeps a stale
   * selection from hijacking a later Ctrl+C-as-SIGINT. Optional.
   */
  invalidateSelection?: () => void;
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
  const {
    term,
    disposedRef,
    setMouseEventsActive,
    setBannerDismissed,
    captureSelection,
    invalidateSelection,
  } = opts;
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
      // Keep the LAST NON-EMPTY selection: Claude's mouse-tracking redraw
      // clears the live selection (fires onSelectionChange with "") a moment
      // after the drag — overwriting the tracker with "" would lose the text
      // the user selected before they can copy it.
      if (sel && sel.trim().length > 0) {
        state.latestSelection = sel;
      } else {
        state.lastCopiedSelection = "";
      }
    } catch {
      /* term may be mid-dispose; ignore */
    }
  });

  const onTerminalMousedown = (event: Event): void => {
    const target = event.target as Node | null;
    const inside = !!(target && termElement.contains(target));
    state.dragStartedInTerminal = inside;
    // Drop the redraw-survival tracker on EVERY mousedown — even one that
    // STARTS OUTSIDE the terminal. Otherwise a cross-boundary drag (mousedown
    // outside → mouseup inside, which produces no live xterm selection)
    // resurrects a stale `latestSelection` at mouseup via the `if (!raw)`
    // fallback and lets it hijack a later Ctrl+C-as-SIGINT (review Finding A).
    // The keyup / Shift+Arrow capture path has no mousedown, so it is
    // unaffected.
    state.latestSelection = "";
    if (inside) {
      invalidateSelection?.();
    }
  };

  // Committing keyboard input invalidates the cached selection so it can't
  // hijack a later Ctrl+C-as-SIGINT. Bare modifiers, the copy chords (the key
  // handler reads the cache on the SAME keydown), and shift-select extensions
  // are exempt. keydown for mouse-reports never fires here (those are xterm
  // onData, not DOM key events), so this is redraw-safe.
  //
  // Registered in the CAPTURE phase: xterm calls `stopPropagation()` on the
  // keydowns it handles, so a bubble-phase document listener would never see a
  // typed character. Capture fires BEFORE xterm's textarea handler — and
  // before the clipboard key handler reads the cache on Ctrl+C — which is why
  // the copy chords are exempted here.
  const onKeydownInvalidate = (event: Event): void => {
    if (disposedRef.current) return;
    const ke = event as KeyboardEvent;
    const active = document.activeElement;
    if (!active || !termElement.contains(active)) return;
    const k = ke.key;
    if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") return;
    if (ke.ctrlKey && (k === "c" || k === "C" || k === "Insert")) return;
    if (ke.shiftKey && /^(Arrow|Home|End|Page)/.test(k)) return;
    invalidateSelection?.();
  };

  const flushSelectionCopy = (event: Event): void => {
    if (disposedRef.current) return;
    // Qualify the gesture (drag-origin gate for mouseup; Shift+navigation for
    // keyup). The drag-origin reset runs for BOTH copy-on-selection states so
    // stale state never carries across gestures.
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
    // Resolve the selection text: live preferred, else the last non-empty
    // tracked value (survives a redraw that cleared the live selection between
    // drag and release).
    let raw = "";
    try {
      if (term.hasSelection()) raw = term.getSelection();
    } catch {
      /* term mid-dispose */
    }
    if (!raw) raw = state.latestSelection;
    if (!raw || raw.trim().length === 0) return;
    // ALWAYS capture for the redraw-proof copy cache + Copy pill. Capturing is
    // NOT a clipboard write — no clobber — so it runs regardless of the pref.
    captureSelection?.(raw);
    // Copy-on-selection AUTO-write stays OPT-IN (default off,
    // iterate-2026-06-30-terminal-paste-single-sink; read live so the Settings
    // toggle takes effect without a remount).
    if (!getCopyOnSelection()) return;
    if (raw === state.lastCopiedSelection) return;
    state.lastCopiedSelection = raw;
    void copyText(raw).catch(() => {
      /* silent — explicit Ctrl+C / Copy pill is the retry path */
    });
  };

  document.addEventListener("mousedown", onTerminalMousedown);
  document.addEventListener("mouseup", flushSelectionCopy);
  document.addEventListener("keyup", flushSelectionCopy);
  document.addEventListener("keydown", onKeydownInvalidate, true);

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
    document.removeEventListener("keydown", onKeydownInvalidate, true);
    observer.disconnect();
  };
}
