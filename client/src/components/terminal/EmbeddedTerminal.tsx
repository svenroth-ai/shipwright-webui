/*
 * EmbeddedTerminal — xterm.js terminal panel hosted in TaskDetailPage.
 *
 * Plan-D''-conform (ADR-034) + ADR-067 (shell-only whitelist) + ADR-068-A1
 * (client-side WS data-frame auto-execute). Webui spawns NO Claude process.
 *
 * Campaign C / C5 (2026-05-26) — the 1856-LOC monolith was split into a
 * thin shell + 8 modules under `client/src/components/terminal/`:
 *   - xtermAddons.ts             — Terminal+addons factory + version-pin
 *   - usePasteImage.ts           — DOM paste image-wins + multipart upload
 *   - useTerminalResize.ts       — ResizeObserver + tab-activation + safeFit
 *   - useReplayDrainGate.ts      — ADR-108 gate + onData/onReplaySnapshot
 *   - useAutoLaunch.ts           — ADR-068-A1 auto-launch + manual-send guard
 *   - useTerminalSelection.ts    — copy-on-selection + mouse-mode banner
 *   - useTerminalShellEffects.ts — banner grace + tab-auto-focus + parent IO
 *   - TerminalBanners.tsx        — presentational banner stack
 *
 * Hard invariants enforced here OR in the extracted modules (CLAUDE.md
 * rules 17-22): convertEol:false; no windowsMode; CLAUDE_CODE_NO_FLICKER
 * default ON; auto-execute via client-side WS data-frame; no legacy
 * chunked-replay envelopes.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import {
  useTerminalSocket,
  type TerminalRole,
} from "../../hooks/useTerminalSocket";
import { useLaunchCoordinator } from "../../contexts/LaunchCoordinatorContext";
import {
  createClipboardKeyHandler,
  readClipboardForPaste,
  type ClipboardNoticeKind,
} from "./terminal-clipboard";
import { attachTouchScroll } from "./touch-scroll";
import { attachScrollRepaint } from "./scroll-repaint";
import { copyText } from "../../lib/clipboard";

import { createEmbeddedXterm } from "./xtermAddons";
import { usePasteImage } from "./usePasteImage";
import { useTerminalResize } from "./useTerminalResize";
import { useReplayDrainGate } from "./useReplayDrainGate";
import { useAutoLaunch } from "./useAutoLaunch";
import { attachTerminalSelection } from "./useTerminalSelection";
import { useTerminalShellEffects } from "./useTerminalShellEffects";
import { TerminalBanners, CLIPBOARD_NOTICE_MS } from "./TerminalBanners";
import { TerminalKeyBar, terminalKeySequence } from "./TerminalKeyBar";

// Re-export gate constants so the existing EmbeddedTerminal.test.tsx imports
// keep working without churn.
export {
  REPLAY_DRAIN_TIMEOUT_MS,
  REPLAY_DRAIN_MAX_BYTES,
} from "./useReplayDrainGate";

export interface EmbeddedTerminalHandle {
  focus(): void;
  ready: boolean;
  role: TerminalRole | null;
}

export interface EmbeddedTerminalProps {
  taskId: string;
  active: boolean;
  socketUrlOverride?: string;
  socketEnabled?: boolean;
  onGitignoreSuggestion?: () => void;
  onBackpressure?: (info: { droppedBytes: number }) => void;
  onReadyChange?: (ready: boolean, role: TerminalRole | null) => void;
  onPasteImageError?: (detail: string) => void;
  onTerminalMeta?: (meta: {
    replayOnly: boolean | null;
    scrollbackBytes: number | null;
    retentionDays: number | null;
    scrollbackDir: string | null;
  }) => void;
}

export const EmbeddedTerminal = forwardRef<
  EmbeddedTerminalHandle,
  EmbeddedTerminalProps
>(function EmbeddedTerminal(
  {
    taskId,
    active,
    socketUrlOverride,
    socketEnabled = true,
    onGitignoreSuggestion,
    onBackpressure,
    onReadyChange,
    onPasteImageError,
    onTerminalMeta,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const disposedRef = useRef(false);

  // Shell-owned banner state.
  const [readOnlyArmed, setReadOnlyArmed] = useState(false);
  const [resetBannerDismissed, setResetBannerDismissed] = useState(false);
  const [clipboardNotice, setClipboardNotice] =
    useState<ClipboardNoticeKind | null>(null);
  const [mouseEventsActive, setMouseEventsActive] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    setResetBannerDismissed(false);
  }, [taskId]);

  // ── Hook chain (lifecycle-ordered) ──
  const coord = useLaunchCoordinator();
  const gate = useReplayDrainGate(termRef, disposedRef);
  const socket = useTerminalSocket({
    taskId,
    urlOverride: socketUrlOverride,
    enabled: socketEnabled,
    onData: gate.onDataChunk,
    onReplaySnapshot: gate.onReplaySnapshot,
    onBackpressure: (info) => onBackpressure?.(info),
  });
  const {
    manualSendCommand,
    previewCommand,
    handleManualSend,
    dismissManualSend,
  } = useAutoLaunch({ taskId, socket, coord, gate });

  usePasteImage({
    taskId,
    containerRef,
    termRef,
    disposedRef,
    onGitignoreSuggestion,
    onPasteImageError,
  });
  useTerminalResize({
    containerRef,
    termRef,
    fitAddonRef,
    disposedRef,
    socketSend: socket.send,
    active,
  });
  useTerminalShellEffects({
    socket,
    active,
    termRef,
    fitAddonRef,
    disposedRef,
    setReadOnlyArmed,
    onReadyChange,
    onTerminalMeta,
  });

  const readOnly = readOnlyArmed && socket.role === "reader";

  // Clipboard-notice auto-dismiss.
  useEffect(() => {
    if (!clipboardNotice) return;
    const t = setTimeout(
      () => setClipboardNotice(null),
      CLIPBOARD_NOTICE_MS[clipboardNotice],
    );
    return () => clearTimeout(t);
  }, [clipboardNotice]);

  // ── Imperative ref ──
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        termRef.current?.focus();
      },
      get ready() {
        return socket.ready;
      },
      get role() {
        return socket.role;
      },
    }),
    [socket.ready, socket.role],
  );

  // ── xterm mount-effect ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handle = createEmbeddedXterm(container);
    termRef.current = handle.term;
    fitAddonRef.current = handle.fit;
    disposedRef.current = false;
    (window as unknown as { __embeddedTerminal?: Terminal | null }).__embeddedTerminal = handle.term;

    handle.term.attachCustomKeyEventHandler(
      createClipboardKeyHandler({
        term: handle.term,
        isDisposed: () => disposedRef.current,
        notify: setClipboardNotice,
        copy: copyText,
        readClipboard: readClipboardForPaste,
      }),
    );

    // ADR-132: buffer-aware touch-scroll routing. In the alt-screen buffer
    // (Claude TUI's default render target — CLAUDE.md rule 22 / ADR-095)
    // pan-delta becomes Cursor-Up/Down keystrokes sent to the pty via the
    // same socket.send({type:"data"}) path that term.onData uses below;
    // the TUI scrolls itself. In the normal buffer the existing
    // term.scrollLines() path is preserved.
    const disposeTouchScroll = attachTouchScroll(handle.term, container, {
      sendData: (payload) => socket.send({ type: "data", payload }),
    });
    // Full-viewport WebGL repaint on scroll — fixes the table-scroll smear.
    const disposeScrollRepaint = attachScrollRepaint(handle.term, container, () => disposedRef.current);
    const disposeSelection = attachTerminalSelection({
      term: handle.term,
      disposedRef,
      setMouseEventsActive,
      setBannerDismissed,
    });

    const onDataDispose = handle.term.onData((data) => {
      socket.send({ type: "data", payload: data });
    });

    return () => {
      // ADR-084 — disposedRef flipped FIRST so straggler async tails of
      // OUR code short-circuit before dereferencing nulled internals.
      disposedRef.current = true;
      onDataDispose.dispose();
      try {
        disposeSelection();
      } catch {
        /* best-effort */
      }
      try {
        disposeScrollRepaint();
        disposeTouchScroll();
      } catch {
        /* best-effort */
      }
      handle.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      (window as unknown as { __embeddedTerminal?: Terminal | null }).__embeddedTerminal = null;
    };
    // socket.send is stable via useCallback; do NOT depend on `socket`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showResetBanner =
    socket.terminalReset === true &&
    !coord.pendingLaunch &&
    !resetBannerDismissed;

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col bg-[#1a1a1a] p-2"
      data-testid="embedded-terminal"
      data-ws-open={socket.open ? "true" : "false"}
      data-ws-ready={socket.ready ? "true" : "false"}
      data-role={socket.role ?? "unknown"}
    >
      <TerminalBanners
        readOnly={readOnly}
        showResetBanner={showResetBanner}
        resetScrollbackBytes={socket.scrollbackBytes}
        onDismissResetBanner={() => setResetBannerDismissed(true)}
        replayOnly={socket.replayOnly === true}
        previewCommand={previewCommand}
        manualSendCommand={manualSendCommand}
        onManualSend={handleManualSend}
        onDismissManualSend={dismissManualSend}
        mouseEventsActive={mouseEventsActive}
        bannerDismissed={bannerDismissed}
        onDismissMouseHint={() => setBannerDismissed(true)}
        clipboardNotice={clipboardNotice}
        onDismissClipboardNotice={() => setClipboardNotice(null)}
      />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        tabIndex={-1}
        data-testid="embedded-terminal-canvas"
      />
      {/* AC-3 — on-screen keys for touch devices (renders null on desktop). */}
      <TerminalKeyBar
        disabled={socket.role !== "writer"}
        onFocusTerminal={() => termRef.current?.focus()}
        onKey={(k) => {
          if (socket.role !== "writer") return;
          const m = termRef.current?.modes?.applicationCursorKeysMode ?? false;
          socket.send({ type: "data", payload: terminalKeySequence(k, m) });
        }}
      />
    </div>
  );
});
