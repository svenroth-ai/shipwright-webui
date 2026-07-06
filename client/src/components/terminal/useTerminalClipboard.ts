/*
 * useTerminalClipboard — clipboard-notice state + a redraw-proof selection
 * cache for the embedded terminal
 * (iterate-2026-07-06-terminal-copy-selection-cache).
 *
 * Why a cache: Claude's TUI runs any-motion mouse tracking (mode 1003); every
 * mouse move is reported to the app, Claude redraws, and an xterm redraw
 * CLEARS the live selection within a moment. So by the time the user presses
 * Ctrl+C the selection is already gone (`hasSelection === false`) and Ctrl+C
 * degrades to SIGINT — copy "does nothing". Empirically confirmed via live
 * `window.__embeddedTerminal` instrumentation (`selectionChange "HELLO123"` →
 * `selectionChange ""` → `onData ""`).
 *
 * This hook captures the last non-empty selection at settle time and holds it,
 * so an explicit copy (the Ctrl+C fallback in `terminal-clipboard.ts`, or the
 * mouse-only Copy pill) reads the captured text instead of the wiped live
 * selection. Capturing is NOT a clipboard write — it never clobbers the OS
 * clipboard, so the #186 copy-on-selection default (opt-in / off) is unchanged.
 *
 * It also owns the transient clipboard-notice state (moved out of
 * `EmbeddedTerminal` to keep the shell within its size budget — a cohesive
 * clipboard concern in one place). The copy write goes through `lib/clipboard`
 * `copyText`, whose `execCommand` fallback works in the non-secure http /
 * Tailscale context where `navigator.clipboard` is absent.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { copyText } from "../../lib/clipboard";
import { CLIPBOARD_NOTICE_MS } from "./TerminalBanners";
import type { ClipboardNoticeKind } from "./terminal-clipboard";

export interface UseTerminalClipboardResult {
  /** Transient corner-pill notice state. */
  clipboardNotice: ClipboardNoticeKind | null;
  /** Surface a notice (copied / copy-failed / paste-hint / paste-failed). */
  notify: (kind: ClipboardNoticeKind) => void;
  /** Dismiss the current notice. */
  dismissClipboardNotice: () => void;
  /** The captured selection offered by the Copy pill, or null when none. */
  copyableSelection: string | null;
  /** Copy the cached selection to the OS clipboard (execCommand over http). */
  onCopySelection: () => void;
  /** Store the last non-empty selection (called at selection settle). */
  captureSelection: (text: string) => void;
  /** Drop the cache + hide the pill (new gesture / committing input / post-copy). */
  invalidateSelection: () => void;
  /** Read the cached selection for the keyboard copy fallback. */
  getCachedSelection: () => string;
}

export function useTerminalClipboard(opts: {
  disposedRef: RefObject<boolean>;
}): UseTerminalClipboardResult {
  const { disposedRef } = opts;

  const [clipboardNotice, setClipboardNotice] =
    useState<ClipboardNoticeKind | null>(null);
  const [copyableSelection, setCopyableSelection] = useState<string | null>(
    null,
  );
  // Imperative cache — the keyboard handler + mousedown/keydown listeners are
  // non-React; a ref lets them read/write without a render per selection cell.
  const cacheRef = useRef("");

  // Auto-dismiss the notice after its per-kind duration.
  useEffect(() => {
    if (!clipboardNotice) return;
    const t = setTimeout(
      () => setClipboardNotice(null),
      CLIPBOARD_NOTICE_MS[clipboardNotice],
    );
    return () => clearTimeout(t);
  }, [clipboardNotice]);

  const notify = useCallback((kind: ClipboardNoticeKind) => {
    setClipboardNotice(kind);
  }, []);

  const dismissClipboardNotice = useCallback(() => {
    setClipboardNotice(null);
  }, []);

  const captureSelection = useCallback((text: string) => {
    if (!text || text.trim().length === 0) return;
    cacheRef.current = text;
    setCopyableSelection(text);
  }, []);

  const invalidateSelection = useCallback(() => {
    cacheRef.current = "";
    setCopyableSelection(null);
  }, []);

  const getCachedSelection = useCallback(() => cacheRef.current, []);

  const onCopySelection = useCallback(() => {
    if (disposedRef.current) return;
    const text = cacheRef.current;
    if (!text || text.trim().length === 0) return;
    void copyText(text).then(
      () => {
        if (disposedRef.current) return;
        setClipboardNotice("copied");
        cacheRef.current = "";
        setCopyableSelection(null);
      },
      () => {
        if (disposedRef.current) return;
        // Keep the cache + pill so the user can retry.
        setClipboardNotice("copy-failed");
      },
    );
  }, [disposedRef]);

  return {
    clipboardNotice,
    notify,
    dismissClipboardNotice,
    copyableSelection,
    onCopySelection,
    captureSelection,
    invalidateSelection,
    getCachedSelection,
  };
}
