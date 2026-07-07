/*
 * useTerminalClipboard — transient clipboard-notice state for the embedded
 * terminal (the corner pill: copy-failed / paste-hint / paste-failed).
 *
 * iterate-2026-07-06 introduced a redraw-proof selection cache + a Copy pill
 * here; both were removed in iterate-2026-07-07-terminal-osc52-clipboard when
 * OSC 52 became the SOLE terminal copy path — Claude Code copies its own mouse
 * selection via OSC 52 and the WebUI relays it (see terminal-osc52.ts). Only
 * the notice state remains, surfaced by the paste handler and the OSC 52
 * relay's copy-failed path.
 */
import { useCallback, useEffect, useState } from "react";

import { CLIPBOARD_NOTICE_MS } from "./TerminalBanners";
import type { ClipboardNoticeKind } from "./terminal-clipboard";

export interface UseTerminalClipboardResult {
  /** Transient corner-pill notice state. */
  clipboardNotice: ClipboardNoticeKind | null;
  /** Surface a notice (copy-failed / paste-hint / paste-failed). */
  notify: (kind: ClipboardNoticeKind) => void;
  /** Dismiss the current notice. */
  dismissClipboardNotice: () => void;
}

export function useTerminalClipboard(): UseTerminalClipboardResult {
  const [clipboardNotice, setClipboardNotice] =
    useState<ClipboardNoticeKind | null>(null);

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

  return { clipboardNotice, notify, dismissClipboardNotice };
}
