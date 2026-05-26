/*
 * TerminalBanners — presentational banner stack for EmbeddedTerminal
 * (Campaign C / C5).
 *
 * Pure JSX, no React state of its own. The shell owns the banner state
 * (readOnly / showResetBanner / replayOnly / previewCommand /
 * manualSendCommand / clipboardNotice / mouse-mode-hint) and passes
 * everything through. This slot exists to keep the shell ≤250 LOC.
 *
 * Banner ordering (top to bottom, source-faithful):
 *   1. read-only (ADR-084 grace-armed)
 *   2. terminal reset (ADR-104)
 *   3. replay-only (Iterate v0.8.2 AC-7)
 *   4. preview command (ADR-068-A1 AC-16)
 *   5. manual-send (resume-cta-rework AC-2)
 *   6. mouse-mode hint (iterate-2026-05-23 terminal-selection-uxd)
 *   7. clipboard notice (iterate-2026-05-18)
 *
 * (1)-(5) render as -mx-2 / -mt-2 header strips on the dark frame; (6)
 * sits absolute top-right; (7) sits absolute bottom-right.
 */

import type { ReactElement } from "react";

import type { ClipboardNoticeKind } from "./terminal-clipboard";

export const CLIPBOARD_NOTICE_TEXT: Record<ClipboardNoticeKind, string> = {
  copied: "Copied",
  "copy-failed": "Copy failed",
  "paste-hint":
    "Keyboard paste needs HTTPS or localhost — use right-click → Paste",
  "paste-failed": "Paste failed — clipboard permission denied",
};
export const CLIPBOARD_NOTICE_MS: Record<ClipboardNoticeKind, number> = {
  copied: 2500,
  "copy-failed": 8000,
  "paste-hint": 8000,
  "paste-failed": 8000,
};
const CLIPBOARD_NOTICE_CLASS: Record<ClipboardNoticeKind, string> = {
  copied: "border-emerald-700 bg-[#0f2417] text-emerald-300",
  "copy-failed": "border-red-800 bg-[#2a1416] text-red-300",
  "paste-hint": "border-sky-800 bg-[#0f1d2e] text-sky-300",
  "paste-failed": "border-red-800 bg-[#2a1416] text-red-300",
};

export interface TerminalBannersProps {
  readOnly: boolean;
  showResetBanner: boolean;
  onDismissResetBanner: () => void;
  replayOnly: boolean;
  previewCommand: string | null;
  manualSendCommand: string | null;
  onManualSend: () => void;
  onDismissManualSend: () => void;
  mouseEventsActive: boolean;
  bannerDismissed: boolean;
  onDismissMouseHint: () => void;
  clipboardNotice: ClipboardNoticeKind | null;
  onDismissClipboardNotice: () => void;
}

export function TerminalBanners(props: TerminalBannersProps): ReactElement {
  const {
    readOnly,
    showResetBanner,
    onDismissResetBanner,
    replayOnly,
    previewCommand,
    manualSendCommand,
    onManualSend,
    onDismissManualSend,
    mouseEventsActive,
    bannerDismissed,
    onDismissMouseHint,
    clipboardNotice,
    onDismissClipboardNotice,
  } = props;
  return (
    <>
      {readOnly ? (
        <div
          className="-mx-2 -mt-2 mb-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
          data-testid="embedded-terminal-readonly"
        >
          Read-only — another tab is the active writer for this task.
        </div>
      ) : null}
      {showResetBanner ? (
        <div
          className="-mx-2 -mt-2 mb-2 flex items-start justify-between gap-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
          data-testid="embedded-terminal-reset"
        >
          <span>
            Terminal was reset — the previous Claude session was interrupted
            (the server may have restarted). Click <strong>Resume</strong> to
            continue.
          </span>
          <button
            type="button"
            onClick={onDismissResetBanner}
            className="shrink-0 rounded px-1 leading-none text-[var(--color-warning,#9a3412)] hover:bg-black/5"
            data-testid="embedded-terminal-reset-dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}
      {replayOnly ? (
        <div
          className="-mx-2 -mt-2 mb-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-3 py-1 text-[11px] text-[var(--color-muted,#6b7280)]"
          data-testid="embedded-terminal-replay-only"
        >
          Session ended — viewing historical terminal scrollback only.
        </div>
      ) : null}
      {previewCommand ? (
        <div
          className="-mx-2 -mt-2 mb-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-info-bg,#eff6ff)] px-3 py-1 font-mono text-[11px] text-[var(--color-info,#1d4ed8)]"
          data-testid="embedded-terminal-launch-preview"
        >
          <span className="opacity-70" aria-hidden>About to run:</span>{" "}
          <span className="break-all">{previewCommand}</span>
        </div>
      ) : null}
      {manualSendCommand ? (
        <div
          className="-mx-2 -mt-2 mb-2 flex flex-col gap-1 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1.5 text-[11px] text-[var(--color-warning,#9a3412)]"
          data-testid="embedded-terminal-manual-send"
        >
          <div className="flex items-start justify-between gap-2">
            <span>
              This terminal already has a session — auto-run is disabled so
              the command can't land inside a running Claude. Send it only
              when the shell is back at a prompt.
            </span>
            <button
              type="button"
              onClick={onDismissManualSend}
              className="shrink-0 rounded px-1 leading-none hover:bg-black/5"
              data-testid="embedded-terminal-manual-send-dismiss"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 break-all font-mono opacity-80">
              {manualSendCommand}
            </span>
            <button
              type="button"
              onClick={onManualSend}
              className="shrink-0 rounded bg-[var(--color-warning,#9a3412)] px-2 py-0.5 font-semibold text-white transition hover:opacity-90"
              data-testid="embedded-terminal-manual-send-button"
            >
              Send to terminal
            </button>
          </div>
        </div>
      ) : null}
      {mouseEventsActive && !bannerDismissed ? (
        <div
          className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded border border-sky-800 bg-[#0f1d2e] px-2.5 py-1 text-[11px] text-sky-300 shadow-md"
          data-testid="embedded-terminal-mouse-mode-hint"
          role="status"
        >
          <span>Maus-Modus aktiv — Shift+Drag zum Markieren</span>
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={onDismissMouseHint}
            className="shrink-0 rounded px-1 leading-none hover:bg-white/10"
            data-testid="embedded-terminal-mouse-mode-hint-dismiss"
            aria-label="Hinweis schließen"
          >
            ✕
          </button>
        </div>
      ) : null}
      {clipboardNotice ? (
        <div
          className={`absolute bottom-3 right-3 z-10 flex max-w-[min(90%,28rem)] items-center gap-2 rounded border px-2.5 py-1 text-[11px] shadow-md ${CLIPBOARD_NOTICE_CLASS[clipboardNotice]}`}
          data-testid="embedded-terminal-clipboard-notice"
          data-notice-kind={clipboardNotice}
        >
          <span>{CLIPBOARD_NOTICE_TEXT[clipboardNotice]}</span>
          {clipboardNotice !== "copied" ? (
            <button
              type="button"
              onClick={onDismissClipboardNotice}
              className="shrink-0 rounded px-1 leading-none hover:bg-white/10"
              data-testid="embedded-terminal-clipboard-notice-dismiss"
              aria-label="Dismiss"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
