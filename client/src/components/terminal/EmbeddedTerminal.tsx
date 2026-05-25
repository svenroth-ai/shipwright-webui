/*
 * EmbeddedTerminal — xterm.js terminal panel hosted inside TaskDetailPage
 * (iterate-2026-05-03 / ADR-067).
 *
 * Plan-D''-conform: this is a NEUTRAL shell pane (pwsh / cmd / bash), not
 * a Claude runner. Claude execution stays user-initiated (Strg+V + Enter
 * after Auto-Copy on Launch — see TaskDetailPage launch-flow).
 *
 * Image-paste contract (ADR-067, AC-6 / AC-6a / AC-6b):
 *   - DOM `paste` listener with capture phase fires BEFORE xterm.
 *   - Image-wins precedence: any ClipboardItem with type starting "image/"
 *     is uploaded to /api/terminal/:taskId/paste-image (multipart). Server
 *     persists to <task.cwd>/.claude-pastes/img-<ts>-<rand>.png and
 *     pty.write()s the shell-quoted absolute path.
 *   - Text-only clipboard: preventDefault + term.paste(text) (bracketed-
 *     paste safe — iterate-2026-05-18 AC-8).
 *   - Mixed clipboard: image wins; text dropped intentionally.
 *
 * Keyboard copy/paste (iterate-2026-05-18 / FR-01.28): a
 * `term.attachCustomKeyEventHandler` wires Ctrl+C / Ctrl+Insert (copy)
 * and Ctrl+V / Shift+Insert (paste) — see terminal-clipboard.ts.
 *
 * The component exposes an imperative ref (`focus()`, `ready`) so the
 * launch-flow side-effect in TaskDetailPage can wait for ready === true
 * before focusing — closes the race surfaced by external review F8.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import {
  useTerminalSocket,
  type TerminalRole,
} from "../../hooks/useTerminalSocket";
import {
  useLaunchCoordinator,
  type CopyCommandForms,
} from "../../contexts/LaunchCoordinatorContext";
import { EMBEDDED_TERMINAL_PALETTE } from "./terminal-theme";
import {
  createClipboardKeyHandler,
  readClipboardForPaste,
  type ClipboardNoticeKind,
} from "./terminal-clipboard";
import { attachTouchScroll } from "./touch-scroll";
import { copyText } from "../../lib/clipboard";

export interface EmbeddedTerminalHandle {
  focus(): void;
  ready: boolean;
  role: TerminalRole | null;
}

/**
 * Prompt-readiness handshake parameters (Decision #12, Review-v7 CRITICAL #2).
 * After the WS reaches `ready=true && role=writer`, wait for the shell to
 * print its prompt before injecting. Heuristic: first onData burst seen +
 * 250ms quiesce.
 *
 * 2026-05-05 — Cold-pty grace path: a freshly-spawned pty on Windows can
 * stay silent for 500–1500ms before the first prompt-paint (oh-my-zsh,
 * Starship, $PROFILE init). The original 3s hard-cap treated that as a
 * timeout and cancelled the launch ("tab flips, command never runs"; second
 * attempt works because the first warmed the pty via Fix C). Two changes:
 *   - PROMPT_READY_NO_DATA_GRACE_MS: if NO data has arrived after this
 *     window, proceed anyway. The shell is silent but listening; the CR
 *     terminator will land in the input buffer and execute when the prompt
 *     paints. Inverted from "must see data" → "see-data wins, silence-grace
 *     wins second."
 *   - PROMPT_HARD_CAP_MS raised to 15s as the absolute cancel boundary
 *     (covers worst-case oh-my-zsh + nvm + fnm cold start).
 */
const PROMPT_QUIESCE_MS = 250;
const PROMPT_READY_NO_DATA_GRACE_MS = 1500;
const PROMPT_HARD_CAP_MS = 15_000;
const PROMPT_POLL_MS = 50;

export interface EmbeddedTerminalProps {
  taskId: string;
  /**
   * Visibility flag from the parent's tab strip. The component stays
   * MOUNTED across tab toggles (Radix `forceMount` on Tabs.Content per
   * external review F3) — this prop only controls whether `fit()` is
   * re-invoked, since hidden containers report 0×0 and break xterm sizing.
   */
  active: boolean;
  /** Override URL for tests; defaults to the live WS endpoint. */
  socketUrlOverride?: string;
  /** Disables auto-connect (for tests). */
  socketEnabled?: boolean;
  /** Surface gitignore-suggestion toast — wired by TaskDetailPage. */
  onGitignoreSuggestion?: () => void;
  /** Surface backpressure events — for diagnostics overlays. */
  onBackpressure?: (info: { droppedBytes: number }) => void;
  /** Surface readiness for the launch-flow handshake. */
  onReadyChange?: (ready: boolean, role: TerminalRole | null) => void;
  /**
   * Surface paste-image upload failures (network errors, server 4xx/5xx)
   * so the parent can show a toast instead of swallowing the failure.
   */
  onPasteImageError?: (detail: string) => void;
  /**
   * Iterate v0.8.2 AC-7/8/9 — surface the server-derived ready-envelope
   * fields (replayOnly, scrollbackBytes, retentionDays, scrollbackDir)
   * to the parent so it can render the conditional disclosure footer
   * and the "Session ended" replay-only banner. Fields stay null until
   * the ready envelope arrives.
   */
  onTerminalMeta?: (meta: {
    replayOnly: boolean | null;
    scrollbackBytes: number | null;
    retentionDays: number | null;
    scrollbackDir: string | null;
  }) => void;
}

const RESIZE_THROTTLE_MS = 250;

/**
 * Transient clipboard notice (iterate-2026-05-18). Rendered as a corner
 * pill OVER the terminal — not a banner-stack strip, so it neither
 * reflows xterm nor collides with the reset / preview banners.
 */
const CLIPBOARD_NOTICE_TEXT: Record<ClipboardNoticeKind, string> = {
  copied: "Copied",
  "copy-failed": "Copy failed",
  "paste-hint":
    "Keyboard paste needs HTTPS or localhost — use right-click → Paste",
  "paste-failed": "Paste failed — clipboard permission denied",
};

/** ms before a notice auto-dismisses. "Copied" is brief; errors/hint linger. */
const CLIPBOARD_NOTICE_MS: Record<ClipboardNoticeKind, number> = {
  copied: 2500,
  "copy-failed": 8000,
  "paste-hint": 8000,
  "paste-failed": 8000,
};

/** Pill tone — copy success vs error vs the non-secure paste hint. */
const CLIPBOARD_NOTICE_CLASS: Record<ClipboardNoticeKind, string> = {
  copied: "border-emerald-700 bg-[#0f2417] text-emerald-300",
  "copy-failed": "border-red-800 bg-[#2a1416] text-red-300",
  "paste-hint": "border-sky-800 bg-[#0f1d2e] text-sky-300",
  "paste-failed": "border-red-800 bg-[#2a1416] text-red-300",
};

/**
 * Replay drain gate (ADR-108, iterate-20260516-terminal-smear-interleave).
 * While a `replay_snapshot` term.write is parsing asynchronously, live
 * `data` is queued rather than written so the two writers cannot
 * interleave and corrupt the xterm buffer (Bug B — left-column smear).
 *   - REPLAY_DRAIN_TIMEOUT_MS — watchdog ceiling; if the snapshot's
 *     completion callback never fires, force-release the gate after this.
 *   - REPLAY_DRAIN_MAX_BYTES — queue size cap, measured in UTF-8 bytes
 *     (`utf8ByteLength` — string `.length` undercounts CJK/emoji). On
 *     overflow the OLDEST queued chunks are dropped (ring-buffer trim);
 *     the gate is NEVER force-drained mid-flight (that re-creates the smear).
 */
export const REPLAY_DRAIN_TIMEOUT_MS = 5_000;
export const REPLAY_DRAIN_MAX_BYTES = 8 * 1024 * 1024;

/** UTF-8 byte length of a string — the replay-drain queue cap is in bytes. */
const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * v0.9.2 (ADR-084) — read-only banner grace window. After a fresh `ready`
 * envelope arrives, suppress the read-only banner for this many ms even if
 * the underlying socket role is "reader". The transient role=reader window
 * is real under React.StrictMode dev double-mount: mount-1 takes writer,
 * mount-2 opens before mount-1's close hits the server, so mount-2 gets
 * `role:"reader"` on its `ready` envelope. The server promotes mount-2 to
 * writer the moment mount-1's close arrives (writer-promoted envelope,
 * synchronous in `PtyManager.detach` per the regression fence in
 * `server/src/terminal/pty-manager.test.ts`). Within a network RTT — well
 * inside this grace window.
 *
 * Re-anchored on every fresh `ready` envelope (NOT just on taskId change)
 * so a WS reconnect on the same task also re-arms cleanly.
 */
const READONLY_BANNER_GRACE_MS = 1500;

/**
 * v0.9.2 (ADR-084) — defense against two xterm hazards:
 *
 *   (a) post-dispose stragglers: an async tail of `fit.fit()` running after
 *       `term.dispose()` would access `term._core._renderService.dimensions`
 *       (nulled by dispose) and throw `Cannot read properties of undefined
 *       (reading 'dimensions')`. That async tail escapes the existing
 *       try/catch frames around the synchronous `fit.fit()` call.
 *
 *   (b) pre-renderer-ready: between `new Terminal()` and the first
 *       fully-rendered frame, `_renderService` may exist but `dimensions`
 *       reports zero `css.cell.width / height`. FitAddon's
 *       `proposeDimensions()` would then compute `Math.floor(width/0) → NaN`
 *       or otherwise mispropose.
 *
 * Brittleness guard (per ADR-084 external review gemini #2): if `_core` or
 * `_renderService` is missing ENTIRELY (e.g. a future xterm refactor
 * renames the private internals), we DON'T silently short-circuit —
 * fall through to fit.fit() inside the try/catch so the path keeps
 * working. Only "renderer present but dimensions invalid" short-circuits.
 *
 * xterm version pinned to @xterm/xterm@^6 (see client/package.json — ADR-097
 * bumped 5.5.0 → 6.0.0). The `_core._renderService.dimensions` private peek
 * still matches on 6.x (verified empirically via the EmbeddedTerminal unit
 * tests). The brittleness-guard fall-through path means a future 6.x refactor
 * that renames the private internals degrades to "fit.fit() inside try/catch"
 * — safe, not silent.
 *
 * Helper accepts `disposed` as a plain boolean — caller passes
 * `disposedRef.current` so React's render isolation doesn't capture a
 * stale `false` (per external review openai #4).
 */
type XtermCorePeek = {
  _renderService?: {
    dimensions?: {
      css?: { cell?: { width?: number; height?: number } };
    };
  };
};
function safeFit(
  fit: FitAddon | null,
  term: Terminal | null,
  disposed: boolean,
): boolean {
  if (disposed || !fit || !term) return false;
  try {
    const core = (term as unknown as { _core?: XtermCorePeek })._core;
    if (core?._renderService) {
      const dims = core._renderService.dimensions;
      const cellW = dims?.css?.cell?.width ?? 0;
      const cellH = dims?.css?.cell?.height ?? 0;
      // Renderer present but dimensions zero/missing → pre-ready → skip.
      // If _core or _renderService is MISSING entirely we fall through to
      // fit.fit() below (brittleness guard).
      if (!dims || cellW === 0 || cellH === 0) return false;
    }
    fit.fit();
    return true;
  } catch {
    // Catches the async-tail TypeError from accessing dimensions on a
    // disposed renderer (the main bug class this helper closes).
    return false;
  }
}

export const EmbeddedTerminal = forwardRef<EmbeddedTerminalHandle, EmbeddedTerminalProps>(
  function EmbeddedTerminal(
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
    const lastResizeAtRef = useRef(0);
    const lastResizePendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // v0.9.2 (ADR-084) — flipped to `true` as the FIRST step of mount-effect
    // cleanup (BEFORE term.dispose()). Any straggler async tail that wins
    // the race against the rest of cleanup is short-circuited by safeFit()
    // before it can dereference a nulled `_renderService`.
    const disposedRef = useRef(false);

    // ADR-068-A1 — auto-launch coordination state (refs survive re-renders).
    const coord = useLaunchCoordinator();
    const consumedTokensRef = useRef<Set<number>>(new Set());
    const lastPtyDataAtRef = useRef(0);
    const dataSeenInitiallyRef = useRef(false);
    const injectionInFlightRef = useRef(false);
    // resume-cta-rework (2026-05-16) — one-shot auto-inject guard.
    // Flips to `true` once a launch command has been auto-sent into the
    // CURRENT pty's lifetime. A subsequent Launch/Resume click must NOT
    // auto-send: the pty may now be running Claude, and a stray
    // `claude --resume …` typed into a live Claude session is the bug
    // the user reported ("had to laboriously delete it"). The second
    // click instead surfaces an explicit "Send to terminal" confirm
    // (`manualSendPending`). Reset on a fresh pty — (re-)mount, taskId
    // change, WS `terminalReset`.
    const launchInjectedThisPtyLifetimeRef = useRef(false);
    // fix-resume-guard-survives-reload (2026-05-17) — once-per-task latch
    // for the reused-pty arming of `launchInjectedThisPtyLifetimeRef`
    // (see the latch effect below). The server's `ready` envelope reports
    // `ptyReused: true` when the WS attach reused a pty that pre-existed
    // this component mount (it persisted across a browser reload /
    // navigate-away-and-back). The latch makes that evaluation happen
    // exactly once per task so a later WS reconnect — which also reports
    // `ptyReused: true` — cannot re-arm. Reset on (re-)mount + taskId
    // change, alongside the guard itself.
    const ptyReusedGuardEvaluatedRef = useRef(false);
    // ADR-108 (iterate-20260516-terminal-smear-interleave) — replay drain
    // gate. `replaySnapshotInFlightRef` is true while a `replay_snapshot`
    // `term.write` is still parsing asynchronously; during that window the
    // `onData` handler QUEUES live `data` instead of writing it, so the
    // snapshot parse and live writes never interleave and corrupt the
    // xterm buffer (Bug B — left-column glyph-fragment smear).
    //   - `replayDrainQueueRef` buffers live chunks while the gate is closed.
    //   - `replayDrainQueueBytesRef` tracks queued size for the byte cap.
    //   - `replayGenerationRef` is a monotonic gate-instance token: the
    //     completion callback and the watchdog capture it at arm-time and
    //     no-op if it has moved on (closes the callback-vs-watchdog
    //     double-drain race and makes a superseding snapshot clean).
    //   - `replayWatchdogRef` holds the force-release timer.
    const replaySnapshotInFlightRef = useRef(false);
    const replayDrainQueueRef = useRef<string[]>([]);
    const replayDrainQueueBytesRef = useRef(0);
    const replayGenerationRef = useRef(0);
    const replayWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearReplayWatchdog = useCallback(() => {
      if (replayWatchdogRef.current !== null) {
        clearTimeout(replayWatchdogRef.current);
        replayWatchdogRef.current = null;
      }
    }, []);
    // Hard reset — taskId change, (re-)mount, unmount cleanup. Bumping the
    // generation neutralises any pending completion callback / watchdog
    // from a prior gate instance.
    const resetReplayGate = useCallback(() => {
      clearReplayWatchdog();
      replaySnapshotInFlightRef.current = false;
      replayDrainQueueRef.current = [];
      replayDrainQueueBytesRef.current = 0;
      replayGenerationRef.current += 1;
    }, [clearReplayWatchdog]);
    // Idempotent gate-settle: the FIRST of {snapshot completion callback,
    // watchdog} to run for `generation` drains the queued live data — as a
    // single concatenated write, single-threaded so no interleave — and
    // releases the gate. Bumping the generation makes the loser a no-op.
    const settleReplayGate = useCallback(
      (generation: number, term: Terminal) => {
        if (replayGenerationRef.current !== generation) return;
        replayGenerationRef.current += 1;
        clearReplayWatchdog();
        replaySnapshotInFlightRef.current = false;
        const queued = replayDrainQueueRef.current;
        replayDrainQueueRef.current = [];
        replayDrainQueueBytesRef.current = 0;
        // Unmounted, or the xterm instance was replaced while the snapshot
        // parse was in flight → drop the queue (nothing to draw on).
        if (disposedRef.current || termRef.current !== term) return;
        try {
          if (queued.length > 0) term.write(queued.join(""));
          term.scrollToBottom();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[terminal] replay drain failed: ${(err as Error).message}`,
          );
        }
      },
      [clearReplayWatchdog],
    );

    // 2026-05-05 — Race-Fix: TaskDetail's route is registered as the SAME
    // <TaskDetailPage/> element across `/tasks/:taskId` so React keeps the
    // EmbeddedTerminal instance mounted when the user navigates from one
    // task to another (TaskBoard → /tasks/A → TaskBoard → /tasks/B). The
    // refs above outlive that taskId change. The most damaging stale ref
    // is `dataSeenInitiallyRef` + `lastPtyDataAtRef`: when a previous pty
    // had emitted any byte, the prompt-readiness handshake passes
    // immediately on the NEW task (`Date.now() - lastPtyDataAt >= 250ms`
    // is trivially true with an old timestamp), so the auto-execute
    // injection fires BEFORE the new pty has rendered its prompt — the
    // shell drops the bytes and the user sees "command never reached the
    // shell" intermittently. Reset on every taskId change so the new
    // task starts with a clean handshake gate.
    useEffect(() => {
      consumedTokensRef.current = new Set();
      lastPtyDataAtRef.current = 0;
      dataSeenInitiallyRef.current = false;
      injectionInFlightRef.current = false;
      // resume-cta-rework — a different task is a different pty: the
      // one-shot inject guard re-arms and any parked manual-send drops.
      launchInjectedThisPtyLifetimeRef.current = false;
      // fix-resume-guard-survives-reload — re-evaluate the reused-pty
      // signal for the new task's first `ready` envelope.
      ptyReusedGuardEvaluatedRef.current = false;
      setManualSendPending(null);
      // ADR-108 — a new task starts with a fully reset replay drain gate.
      resetReplayGate();
      // ADR-104 — a different task gets a fresh reset-banner evaluation.
      setResetBannerDismissed(false);
    }, [taskId, resetReplayGate]);

    const socket = useTerminalSocket({
      taskId,
      urlOverride: socketUrlOverride,
      enabled: socketEnabled,
      onData: (chunk) => {
        // Prompt-readiness bookkeeping stays UNCONDITIONAL — the byte DID
        // arrive on the wire (this feeds the ADR-068-A1 auto-launch
        // handshake, a wire-receipt signal independent of whether the
        // chunk has been rendered yet).
        if (!dataSeenInitiallyRef.current) dataSeenInitiallyRef.current = true;
        lastPtyDataAtRef.current = Date.now();
        // ADR-108 — replay drain gate. While a `replay_snapshot` write is
        // parsing, queue the live chunk instead of writing it, so the two
        // writers cannot interleave and corrupt the xterm buffer.
        if (replaySnapshotInFlightRef.current) {
          const queue = replayDrainQueueRef.current;
          queue.push(chunk);
          replayDrainQueueBytesRef.current += utf8ByteLength(chunk);
          // Byte cap — drop the OLDEST chunks (ring-buffer trim) to stay
          // bounded. Never force-drain mid-flight: that re-issues
          // concurrent writes and re-creates the smear (external review
          // HIGH finding). At least the newest chunk is always kept.
          while (
            replayDrainQueueBytesRef.current > REPLAY_DRAIN_MAX_BYTES &&
            queue.length > 1
          ) {
            const dropped = queue.shift();
            if (dropped !== undefined) {
              replayDrainQueueBytesRef.current -= utf8ByteLength(dropped);
            }
          }
          return;
        }
        termRef.current?.write(chunk);
      },
      onReplaySnapshot: ({ data, terminalVersion }) => {
        // ADR-087/089 — single-envelope cell-state replay. The server has
        // already stabilised the payload via M2 double-serialize, so the
        // client writes ONCE into xterm.
        const term = termRef.current;
        if (!term) return;
        // Best-effort version-family check. The server's version gate is
        // the authoritative accept/reject layer; this is just a console
        // warning when minor versions drift across the same major.
        if (terminalVersion) {
          try {
            const major = terminalVersion.split(".")[0];
            if (major && major !== "6") {
              // eslint-disable-next-line no-console
              console.warn(
                `[terminal] replay_snapshot served by xterm major ${major}; client xterm.js is major 6 — visual artifacts possible`,
              );
            }
          } catch {
            /* ignore */
          }
        }
        // ADR-108 — (re-)arm the replay drain gate. A `replay_snapshot` is
        // parsed by xterm ASYNCHRONOUSLY; while it parses, the `onData`
        // handler queues live `data` so the two writers never interleave
        // (Bug B — the smear is concurrent writes corrupting the buffer).
        // A fresh snapshot is authoritative: live data queued for a PRIOR
        // snapshot window is superseded — bumping the generation both
        // drops that queue and neutralises the prior gate's pending
        // completion callback + watchdog.
        replayGenerationRef.current += 1;
        const generation = replayGenerationRef.current;
        clearReplayWatchdog();
        replayDrainQueueRef.current = [];
        replayDrainQueueBytesRef.current = 0;
        replaySnapshotInFlightRef.current = true;
        // Watchdog — if xterm drops the completion callback (internal
        // error / mid-dispose), force-release the gate so live data is not
        // queued forever. settleReplayGate is idempotent vs. the callback
        // (whichever runs first wins; the loser sees a stale generation).
        replayWatchdogRef.current = setTimeout(() => {
          replayWatchdogRef.current = null;
          settleReplayGate(generation, term);
        }, REPLAY_DRAIN_TIMEOUT_MS);
        try {
          // `term.reset()` (not `clear()`) re-initialises cursor +
          // viewport + scrollback so the snapshot writes into a truly
          // fresh state on re-attach.
          try {
            term.reset();
          } catch {
            /* xterm mid-dispose; ignore */
          }
          // `term.write(data, cb)` — xterm's correct "after parse" hook.
          // The gate drains queued live data inside the completion
          // callback, after the snapshot parse has fully landed.
          term.write(data, () => {
            settleReplayGate(generation, term);
          });
        } catch (err) {
          // `term.write` threw synchronously (xterm mid-dispose). Release
          // the gate and DROP the queued live data — AC-3 requires the
          // catch to CLEAR the queue, not drain it onto a terminal whose
          // snapshot write just failed. resetReplayGate bumps the
          // generation, so the watchdog armed just above also no-ops.
          resetReplayGate();
          // eslint-disable-next-line no-console
          console.warn(
            `[terminal] replay_snapshot write failed: ${(err as Error).message}`,
          );
        }
      },
      onBackpressure: (info) => {
        onBackpressure?.(info);
      },
    });

    // v0.9.2 (ADR-084) — read-only banner with a 1500 ms grace window
    // anchored on the rising edge of `socket.ready`. The grace closes the
    // StrictMode-mount-1-takes-writer / mount-2-briefly-reader / promotion
    // race: the writer-promoted envelope reaches mount-2 within a network
    // RTT (synchronous server-side per `pty-manager.test.ts`), well inside
    // 1500 ms. After the grace window the banner DOES render if the role
    // is genuinely stable at "reader" (a second real tab is open).
    //
    // Two effects feed `readOnlyArmed`:
    //   (1) [socket.ready] effect — on the rising edge (false → true),
    //       reset `armed = false` (banner hidden). New WS attach within
    //       the same component lifetime (reconnect) re-arms cleanly.
    //   (2) [socket.role, socket.ready] effect — schedules the arm-timer
    //       when ready AND role === "reader"; cleans up its own timer on
    //       every dep change. Effects don't share state with each other,
    //       so the gemini #1 ordering hazard does not apply.
    //
    // Data-send behavior stays tied to actual `socket.role` server-side
    // gate (`server/src/terminal/routes.ts onMessage` checks getRole and
    // emits `read_only` envelope). The grace is purely visual debounce.
    const [readOnlyArmed, setReadOnlyArmed] = useState(false);
    // ADR-104 — the reset banner is dismissable; the flag resets on
    // taskId change (see the [taskId] effect above).
    const [resetBannerDismissed, setResetBannerDismissed] = useState(false);
    // iterate-2026-05-18 — transient copy/paste notice (corner pill).
    const [clipboardNotice, setClipboardNotice] =
      useState<ClipboardNoticeKind | null>(null);
    // iterate-2026-05-23 (terminal-selection-uxd) — VS Code-style
    // copy-on-selection.
    //
    // External-review HIGH-1 + HIGH-2 (both reviewers): `onSelectionChange`
    // fires per cell during a drag and async callbacks lose the browser's
    // transient-user-activation, so calling `copyText()` from inside the
    // selection-change handler would (a) spam the OS clipboard 100+ times
    // per drag and (b) silently fail under strict browser permission
    // policies (Safari + execCommand fallback). The fix is the
    // "track-then-flush" pattern lifted from VS Code's terminal contrib
    // (`terminal.clipboard.contribution.ts:64` — they too key `copyOnSelection`
    // off `onSelectionChange` but they perform the OS clipboard write via
    // user-action paths; we mirror that intent by doing the clipboard
    // write inside native `mouseup` / `keyup` handlers on `term.element`).
    //
    //   - `latestSelectionRef` — every `term.onSelectionChange` fire writes
    //     the current selection here. Cheap (string assignment), bounded
    //     (last value only).
    //   - `lastCopiedSelectionRef` — the most recent value we actually
    //     wrote to the OS clipboard. Dedup: a second mouseup on the same
    //     selection is a no-op.
    //
    // Auto-copy is SILENT (no `notify("copied")`); the existing Ctrl+C
    // pill remains reserved for explicit copy chords so the notification
    // semantics stay consistent and users aren't bombarded with toasts on
    // every drag.
    const latestSelectionRef = useRef("");
    const lastCopiedSelectionRef = useRef("");
    // iterate-2026-05-23 (terminal-selection-uxd) — Shift+Drag
    // discoverability banner. xterm-core toggles the `.enable-mouse-events`
    // class on its root element whenever DECSET 1000/1002/1003/1006 is
    // active (i.e. the foreground app like Claude TUI is consuming mouse
    // events, blocking drag-select). When that class is present, we show
    // a small dismissable hint badge so the user discovers Shift+Drag
    // (xterm.js's built-in escape hatch — its MouseService bypasses mouse
    // mode when shiftKey is pressed). VS Code relies on a CSS-only signal
    // (`.xterm.enable-mouse-events { cursor: default }`) which is a quiet
    // hint; on Windows where cursor-by-app is muted, an in-pane badge is
    // a stronger affordance.
    //
    //   - `mouseEventsActive` mirrors the class presence. Initial state
    //     is read synchronously when the observer attaches so a terminal
    //     mounted ALREADY in mouse mode shows the banner immediately
    //     (external-review MED-7).
    //   - `bannerDismissed` lets the user × the banner away. Reset to
    //     `false` on every off→on class transition so a dismiss does not
    //     stick forever — the user sees it again the next time mouse
    //     mode engages on a fresh app.
    const [mouseEventsActive, setMouseEventsActive] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);
    // resume-cta-rework (2026-05-16) — when a Launch/Resume click lands
    // on a pty that already had a launch injected (the one-shot guard
    // fired), the three-shell-form commands are parked here and
    // surfaced as an explicit "Send to terminal" confirm banner — never
    // auto-sent. The resume-vs-fresh distinction is already baked into
    // each command string by the launcher, so only `commands` is kept.
    const [manualSendPending, setManualSendPending] = useState<
      { commands: CopyCommandForms } | null
    >(null);
    const prevReadyRef = useRef(false);
    useEffect(() => {
      if (socket.ready && !prevReadyRef.current) {
        setReadOnlyArmed(false);
      }
      prevReadyRef.current = socket.ready;
    }, [socket.ready]);
    useEffect(() => {
      if (!socket.ready || socket.role !== "reader") {
        setReadOnlyArmed(false);
        return;
      }
      const t = setTimeout(() => {
        setReadOnlyArmed(true);
      }, READONLY_BANNER_GRACE_MS);
      return () => clearTimeout(t);
    }, [socket.role, socket.ready]);
    const readOnly = readOnlyArmed && socket.role === "reader";

    // iterate-2026-05-23 (terminal-tab-autofocus) — auto-focus xterm
    // when the Terminal tab becomes active. VS Code's integrated
    // terminal grabs keyboard focus on tab-switch; we mirror that
    // so users don't have to click the canvas before typing.
    //
    // The naïve `useEffect(() => term.focus(), [active, socket.ready])`
    // would fire `focus()` on EVERY unrelated re-render where both
    // deps stay true (banner state changes, ResizeObserver updates,
    // socket.role bumps within a stable-active window). On a page
    // with another focused input (title editor, settings field,
    // task-creation modal) that would steal focus mid-typing.
    //
    // Guard via a "focused-once-per-active-window" ref: clear when
    // `active` goes false; set when we focus. Stable-active re-runs
    // become no-ops because the ref already says "focused for this
    // window". The `focusTerminal` nav-state path (Inbox-click flow,
    // iterate-2026-05-18-inbox-terminal-prompts) is orthogonal — it
    // calls `ref.focus()` imperatively at mount, before this effect
    // would fire; both end up calling `term.focus()` which is
    // idempotent in xterm.js.
    const tabAutoFocusedRef = useRef(false);
    useEffect(() => {
      if (!active) {
        tabAutoFocusedRef.current = false;
        return;
      }
      if (!socket.ready) return;
      if (tabAutoFocusedRef.current) return;
      tabAutoFocusedRef.current = true;
      // Defer one tick so Radix Tabs.Content has flipped its
      // `data-[state=inactive]:hidden` CSS to visible before we
      // call `xterm.focus()`. xterm focus internally focuses the
      // hidden helper-textarea; `focus()` on an element inside a
      // `display:none` ancestor is a SILENT no-op (HTML spec), and
      // the click target (the tab trigger button) ends up holding
      // focus instead. F0.5 spec 88 caught this empirically — see
      // iterate-2026-05-23-terminal-tab-autofocus. setTimeout(0)
      // is the cheapest schedule that lands after the layout pass;
      // rAF is also correct but jsdom doesn't tick rAF naturally,
      // so the unit tests would need fake-timer plumbing.
      const t = setTimeout(() => {
        if (disposedRef.current) return;
        // Repair stale renderer state before focusing. xterm.open()
        // ran during initial mount when the Terminal-tab container
        // was `display:none` (Transcript was the persisted default),
        // so the canvas/WebGL atlas initialised at 0x0. ResizeObserver
        // does fire on the hide→show transition, but xterm's
        // internal renderer can carry the stale-zero atlas state
        // through the first paint — visible to the user as a
        // "broken" terminal display that only clears after a full
        // task remount. Fit + refresh forces a complete repaint of
        // every visible row against the now-real cell dims.
        const term = termRef.current;
        const fit = fitAddonRef.current;
        if (term && fit) {
          safeFit(fit, term, disposedRef.current);
          try {
            term.refresh(0, term.rows - 1);
          } catch {
            /* term mid-dispose — refresh is best-effort */
          }
        }
        try {
          term?.focus();
        } catch {
          /* term mid-dispose — focus is best-effort */
        }
      }, 0);
      return () => clearTimeout(t);
    }, [active, socket.ready]);

    // iterate-2026-05-18 — auto-dismiss the clipboard notice. "Copied"
    // clears quickly; the error / hint notices linger (and carry a ✕).
    useEffect(() => {
      if (!clipboardNotice) return;
      const t = setTimeout(
        () => setClipboardNotice(null),
        CLIPBOARD_NOTICE_MS[clipboardNotice],
      );
      return () => clearTimeout(t);
    }, [clipboardNotice]);

    // Surface ready for the launch-flow handshake.
    useEffect(() => {
      onReadyChange?.(socket.ready, socket.role);
    }, [socket.ready, socket.role, onReadyChange]);

    // Iterate v0.8.2 AC-7/8/9 — surface the new ready-envelope fields.
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

    // Shared image-upload helper.
    //
    // The DOM `paste` event listener (right-click → Paste menu;
    // programmatic paste; Edge/Chrome legacy paths) routes image blobs
    // through this single fetch so success / error / gitignore surfaces
    // stay consistent.
    //
    // History: v0.8.3 AC-1 added a second consumer here — a
    // `term.attachCustomKeyEventHandler` Ctrl+V interceptor that drove
    // `navigator.clipboard.read()` directly. v0.8.5 AC-2 reverted that
    // path because the value didn't justify the surface in production:
    // Alt+V via Claude Code's TUI clipboard pipeline is the supported
    // image-paste flow (lands under `~/.claude/image-cache/...`), and
    // the v0.8.3 Ctrl+V path never produced a reliable round-trip in
    // the user's daily flow. The DOM `paste` listener below remains as
    // defense-in-depth for non-keyboard paste paths.
    const uploadPasteBlob = useCallback(
      async (blob: Blob, filename: string): Promise<void> => {
        const form = new FormData();
        form.append("image", blob, filename);
        const url = `/api/terminal/${encodeURIComponent(taskId)}/paste-image`;
        try {
          const res = await fetch(url, { method: "POST", body: form });
          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              const body = (await res.json().catch(() => null)) as
                | { error?: string }
                | null;
              if (body?.error) detail = body.error;
            } catch {
              /* fall through */
            }
            onPasteImageError?.(detail);
            return;
          }
          const body = (await res.json().catch(() => null)) as
            | { gitignoreSuggestion?: boolean }
            | null;
          if (body?.gitignoreSuggestion) {
            onGitignoreSuggestion?.();
          }
        } catch (err) {
          onPasteImageError?.(err instanceof Error ? err.message : String(err));
        }
      },
      [taskId, onGitignoreSuggestion, onPasteImageError],
    );

    // Imperative API exposed to the parent.
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

    // fix-resume-guard-survives-reload (2026-05-17) — arm the one-shot
    // inject guard when the WS attached to a pty that pre-existed this
    // component mount.
    //
    // `launchInjectedThisPtyLifetimeRef` is in-memory per mount. A
    // browser reload (or navigate-away-and-back) remounts EmbeddedTerminal
    // with a fresh `false` guard, while the SERVER pty persists (30-min
    // idle ceiling). Without this, the first post-reload Launch/Resume
    // would auto-inject `claude --resume …` straight into the still-live
    // Claude session running in that persisted pty — the exact bug the
    // one-shot guard exists to prevent, leaking back in on every reload.
    //
    // The server's `ready` envelope carries `ptyReused: true` for a
    // reused pty. On the FIRST `ready` envelope for the current task,
    // `ptyReused: true` means the pty predates this mount: we cannot
    // vouch for what is running in it, so arm the guard — a subsequent
    // Launch/Resume then routes through the explicit "Send to terminal"
    // confirm (`manualSendPending`) instead of auto-injecting.
    //
    // Latched via `ptyReusedGuardEvaluatedRef` so the evaluation happens
    // exactly once per task: a later WS reconnect within the same mount
    // also reports `ptyReused: true` (the pty persisted), but must NOT
    // re-arm — past the first attach the guard is driven solely by the
    // auto-inject / `terminalReset` / taskId-change logic.
    //
    // Declared BEFORE the auto-launch effect below so that, when both run
    // in the same commit, the guard is armed before auto-inject reads it.
    //
    // Known dev-only papercut: under React.StrictMode (dev builds only)
    // the effect double-invoke makes the second WS attach observe
    // `ptyReused: true` (the first invoke created the pty), so the guard
    // arms on a freshly-opened task and the first launch needs one
    // explicit "Send to terminal" click. Production builds do not
    // double-invoke StrictMode effects. Accepted: a safe false-positive
    // (one extra click in dev) over the dangerous false-negative
    // (auto-inject into a live Claude after a reload).
    useEffect(() => {
      if (!socket.ready) return;
      if (ptyReusedGuardEvaluatedRef.current) return;
      ptyReusedGuardEvaluatedRef.current = true;
      if (socket.ptyReused === true) {
        launchInjectedThisPtyLifetimeRef.current = true;
      }
    }, [socket.ready, socket.ptyReused]);

    // ADR-068-A1: auto-launch flow.
    //
    // Watches the LaunchCoordinator pendingLaunch. When all preconditions
    // hold (writer + ready + shellKind known) AND the prompt-readiness
    // handshake clears, sends `commands[shellKind] + "\r"` over WS and
    // marks the token consumed. consumedTokensRef defends against
    // duplicate injection on remount / WS reconnect / StrictMode.
    //
    // Reader-tab cancel is handled by TaskDetailPage (it owns the
    // coordinator state and watches the EmbeddedTerminal role via the
    // imperative ref + onReadyChange).
    useEffect(() => {
      const pending = coord.pendingLaunch;
      if (!pending) return;
      if (consumedTokensRef.current.has(pending.launchToken)) return;
      if (injectionInFlightRef.current) return;
      if (!socket.ready || socket.role !== "writer") return;
      if (!socket.shellKind) return;
      // Cancelled / expired clientside while we waited.
      if (pending.expiresAt <= Date.now()) return;

      // resume-cta-rework (2026-05-16) — one-shot guard. webui already
      // AUTO-INJECTED a launch into THIS pty's lifetime, so that launch
      // is plausibly still running Claude. Auto-sending again would
      // type `claude --resume …` straight into it. Park the command
      // behind an explicit "Send to terminal" confirm (AC-2
      // confirm-on-reuse) and release the coordinator token so the CTA
      // re-enables. Scope note: this guards the webui-auto-inject path
      // only — a Claude the user started by hand-typing into the pane
      // is not detected (see the iterate spec's Out of Scope).
      if (launchInjectedThisPtyLifetimeRef.current) {
        consumedTokensRef.current.add(pending.launchToken);
        setManualSendPending({ commands: pending.commands });
        coord.consumeLaunch(pending.launchToken);
        return;
      }

      let cancelled = false;
      injectionInFlightRef.current = true;

      void (async () => {
        // Prompt-readiness handshake (Decision #12).
        const startWait = Date.now();
        let handshakeCleared = false;
        while (!cancelled && Date.now() - startWait < PROMPT_HARD_CAP_MS) {
          const waited = Date.now() - startWait;
          if (
            dataSeenInitiallyRef.current &&
            Date.now() - lastPtyDataAtRef.current >= PROMPT_QUIESCE_MS
          ) {
            handshakeCleared = true;
            break;
          }
          if (
            !dataSeenInitiallyRef.current &&
            waited >= PROMPT_READY_NO_DATA_GRACE_MS
          ) {
            handshakeCleared = true;
            break;
          }
          await new Promise((r) => setTimeout(r, PROMPT_POLL_MS));
        }
        if (cancelled) return;

        // Phase-3 review fix (HIGH): the hard-cap is a CANCEL boundary,
        // NOT permission to inject blindly. With the cold-pty grace path
        // (1.5s silence ⇒ proceed) reaching the 15s hard-cap means
        // something is genuinely wrong (pty hung, prompt never rendered);
        // cancel explicitly so the CTA re-enables and the user can retry.
        if (!handshakeCleared) {
          consumedTokensRef.current.add(pending.launchToken);
          coord.cancelLaunch("timeout");
          return;
        }

        // Re-check preconditions — coord state may have changed.
        if (consumedTokensRef.current.has(pending.launchToken)) return;
        if (!socket.ready || socket.role !== "writer") return;
        if (!socket.shellKind) return;
        // Phase-3 review fix (HIGH): explicit timeout-cancel on expired
        // pending entry instead of silently returning. Surfaces the
        // deterministic cancel-reason ("timeout") in coord state.
        if (pending.expiresAt <= Date.now()) {
          consumedTokensRef.current.add(pending.launchToken);
          coord.cancelLaunch("timeout");
          return;
        }

        const cmd =
          socket.shellKind === "pwsh"
            ? pending.commands.powershell
            : socket.shellKind === "cmd"
              ? pending.commands.cmd
              : pending.commands.posix;

        consumedTokensRef.current.add(pending.launchToken);
        socket.send({ type: "data", payload: cmd + "\r" });
        // resume-cta-rework — the pty has now had a launch injected;
        // any further launch this lifetime routes through manual confirm.
        launchInjectedThisPtyLifetimeRef.current = true;
        coord.consumeLaunch(pending.launchToken);
      })().finally(() => {
        injectionInFlightRef.current = false;
      });

      return () => {
        cancelled = true;
      };
    }, [coord, socket.ready, socket.role, socket.shellKind, coord.pendingLaunch]);

    // resume-cta-rework (2026-05-16) — explicit confirm for a launch
    // into a pty that already had one injected (the one-shot guard
    // parked the command in `manualSendPending`). Sends the
    // shell-appropriate bytes immediately: the user clicking this IS
    // the confirmation that the terminal is at a usable prompt, so
    // there is no prompt-readiness handshake — the pty is mid-session,
    // not freshly spawned.
    const handleManualSend = useCallback(() => {
      const pending = manualSendPending;
      if (!pending) return;
      if (!socket.ready || socket.role !== "writer" || !socket.shellKind) {
        return;
      }
      const cmd =
        socket.shellKind === "pwsh"
          ? pending.commands.powershell
          : socket.shellKind === "cmd"
            ? pending.commands.cmd
            : pending.commands.posix;
      socket.send({ type: "data", payload: cmd + "\r" });
      setManualSendPending(null);
      // Narrow deps: `socket` is a fresh object each render, so
      // depending on it whole would defeat the memo. `socket.send` is
      // stable (useCallback in useTerminalSocket); the rest are values.
    }, [
      manualSendPending,
      socket.ready,
      socket.role,
      socket.shellKind,
      socket.send,
    ]);

    // resume-cta-rework — a WS `terminalReset` means a FRESH pty
    // replaced a lost session. Re-arm the one-shot guard so the first
    // launch into the new pty auto-injects again, and drop any parked
    // manual-send (it referenced the dead pty).
    useEffect(() => {
      if (socket.terminalReset === true) {
        launchInjectedThisPtyLifetimeRef.current = false;
        setManualSendPending(null);
      }
    }, [socket.terminalReset]);

    // Mount xterm + addons exactly once per component lifetime.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Iterate v0.8.2 AC-2 (black-on-black input rendering): the embedded
      // terminal is a shell pane that primarily hosts Claude Code's TUI
      // (ADR-067). Claude's TUI input box assumes a dark terminal: when
      // mounted on the light brand palette, its self-styled fg/bg slots
      // collided with our `white = #6b5e56` brand-brown to produce
      // illegible black-on-near-black input. Per spec option (b), switch
      // the embedded terminal to a dark theme ONCE at session start
      // (terminal-creation = session-start) so Claude TUI renders cleanly
      // and a typed shell prompt still reads at WCAG AA.
      //
      // Palette is tuned so:
      //   - foreground (#f5f0eb cream) on background (#1a1a1a) ≥ 12:1
      //   - every normal ANSI slot 0–7 lands ≥ 4.5:1 against background
      //     EXCEPT the `black` slot (intentional — text written `\e[30m`
      //     on the default bg should stay near-black; reverse-video flips
      //     fg/bg so the input box gets the high-contrast cream-on-dark)
      //   - the `white` slot is a real near-white (#e5e0d8), not the
      //     brand-brown that triggered the regression.
      // Brand semantics still flow through CSS-vars where the slot has a
      // natural correspondence (error = red, success = emerald, etc.).
      const cssVar = (name: string, fallback: string) =>
        getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
      const palette = EMBEDDED_TERMINAL_PALETTE;
      // convertEol — MUST stay `false`. ConPTY, and Claude Code's TUI
      // running under it, emits a bare LF as "cursor down, keep column";
      // a real terminal honours that. `convertEol: true` makes xterm.js
      // additionally carriage-return on every LF, yanking the cursor to
      // column 0 — the next write then lands at column 0 and smears over
      // the kept-column content. That is Bug B: the left-column glyph
      // smear visible when scrolling a Claude Code session.
      //
      // ADR-093 (Iterate F) had flipped this knob to `true` as an
      // xterm-5.x-era mitigation for a status-pane "stacking" redraw.
      // That flip was itself the root cause of Bug B — confirmed by a
      // deterministic @xterm/headless repro and user UAT, and now
      // superseded. Regression guard:
      // server/src/terminal/embedded-terminal-convert-eol.test.ts.
      // See decision_log (run-id iterate-2026-05-16-converteol-smear).
      // ADR-093's other Vorbild-alignment knobs (allowProposedApi,
      // scrollback — both below) are unaffected and stay as-is.
      //
      // Iterate I (ADR-097) — the `windowsMode: false` knob was removed
      // when xterm.js 6.0.0 retired the option: 6.x detects the Windows
      // path purely from `process.platform` / userAgent with no public
      // override, so an explicit `false` is at best a no-op and at worst
      // a type-error on the `ITerminalOptions` interface.
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 13,
        theme: {
          background: palette.background,
          foreground: palette.foreground,
          cursor: palette.cursor,
          cursorAccent: palette.cursorAccent,
          selectionBackground: palette.selectionBackground,
          black: palette.black,
          red: palette.red,
          green: palette.green,
          yellow: palette.yellow,
          blue: palette.blue,
          magenta: palette.magenta,
          cyan: palette.cyan,
          white: palette.white,
          brightBlack: palette.brightBlack,
          // Brand semantics still flow through CSS-vars where the slot
          // has a natural correspondence; fallback matches the static
          // palette so test luminance assertions stay deterministic.
          brightRed: cssVar("--color-error", palette.brightRed),
          brightGreen: cssVar("--color-success", palette.brightGreen),
          brightYellow: cssVar("--color-warning", palette.brightYellow),
          brightBlue: cssVar("--color-info", palette.brightBlue),
          brightMagenta: cssVar("--color-purple", palette.brightMagenta),
          brightCyan: palette.brightCyan,
          brightWhite: palette.brightWhite,
        },
        scrollback: 10000,
        allowProposedApi: true,
        // Iterate K (ADR-099) — rescale glyphs that exceed cell width so
        // they don't bleed into the next cell. xterm 6.0's default is
        // `false`, which Daniel Imms documents as a real bug in
        // xtermjs/xterm.js#5100 ("Overlapping glyphs don't merge AA
        // gracefully"). The symptom matches our user-reported "Verschmie-
        // rungen" / smearing: on glyphs like `m`, `w`, `@`, and some
        // Unicode in narrow fonts, the rendered glyph width exceeds the
        // monospace cell width by a few px. Without rescale, those pixels
        // bleed into the adjacent cell — visually a smear at high-
        // frequency micro-updates (e.g. Claude TUI emits per-word writes
        // separated by `\x1b[1C` cursor-rights, so wide glyphs end up
        // touching at almost every cell boundary).
        //
        // VS Code sets this via terminalConfiguration setting
        // `terminal.integrated.rescaleOverlappingGlyphs` which defaults
        // to `true`. Their xtermTerminal.ts threads it through.
        rescaleOverlappingGlyphs: true,
        // iterate-2026-05-23 (terminal-selection-uxd) — VS Code-parity
        // selection knobs. References at commit b433c7d:
        //   - src/vs/workbench/contrib/terminal/browser/xterm/
        //     xtermTerminal.ts:226-275 — full options block (sets
        //     `rightClickSelectsWord`, `macOptionClickForcesSelection`,
        //     `wordSeparator`).
        //   - src/vs/workbench/contrib/terminal/common/
        //     terminalConfiguration.ts — `terminalWordSeparators` default
        //     `" ()[]{}',\"\`|;:!?"`.
        // Together with the `MutationObserver`-driven "Shift+Drag" hint
        // below, these align our drag-/right-click-/double-click selection
        // behaviour with the VS Code integrated terminal so the embedded
        // pane no longer feels rougher than the IDE pane.
        rightClickSelectsWord: true,
        macOptionClickForcesSelection: true,
        wordSeparator: " ()[]{}',\"`|;:!?",
        // Note (Iterate K UAT 2026-05-14): `scrollOnEraseInDisplay: true`
        // was tested here as VS Code-parity for AI-CLI ED2-driven scrollbar-
        // shake (per xterm.js issue #5620 + @jerch on #5801). The option
        // was added in xterm 6.0.0 and does NOT exist in the 5.5.0 typings.
        // We're running 5.5.0 de facto (post-ADR-097 npm-install drift —
        // package.json says 6.0.0 but node_modules has 5.5.0) so the
        // option is a tsc compile error here. Removed; revisit after
        // a real `npm install` brings the runtime to 6.0.0. Even then
        // it's defense-in-depth for our NO_FLICKER=1 path, since Claude
        // emits zero ED2 sequences under that env.
      });
      const fit = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);
      // Iterate K (ADR-099) — WebGL loaded BEFORE term.open(container) so the
      // DOM renderer never initializes. Without this, xterm.js stands up the
      // DOM renderer at open(), renders the first frames, then tears it down
      // and swaps to WebGL when the addon is loaded post-open — leaking
      // partial-redraw state into Claude TUI's high-frequency alt-screen
      // CUP-heavy stream (smearing, column-0 fragments, click-flicker).
      //
      // Cross-referenced against three xterm.js consumers:
      //   1. xtermjs/xterm.js demo/client/client.ts:342-354 — official
      //      maintainer demo loads WebGL BEFORE open() (canonical pattern).
      //   2. siteboon/claudecodeui src/components/shell/hooks/
      //      useShellTerminal.ts:87-104 — same "before open" order.
      //   3. microsoft/vscode src/vs/workbench/contrib/terminal/browser/
      //      xterm/xtermTerminal.ts:495 — currently AFTER open() with an
      //      explicit `// TODO: Move before open so the DOM renderer doesn't
      //      initialize` from the xterm.js BDFL's own team.
      // ADR-093's "WebGL must be loaded AFTER term.open(container) — addon-
      // webgl needs an attached DOM context" claim was incorrect:
      // WebglAddon.activate() registers core.onWillOpen if !terminal.element,
      // deferring real initialization until open() fires.
      //
      // Try/catch documents the Canvas/DOM fallback path: headless test envs
      // (jsdom), browsers with WebGL disabled, or hosts where the GPU is
      // blacklisted all land cleanly in the default renderer without crashing
      // the mount. The 2026-05-14 WebGL-off A/B probe confirmed Canvas/DOM
      // alt-screen rendering is severely worse than WebGL — fallback is a
      // graceful-degradation surface, not a target configuration.
      // WebGL is loaded unconditionally — the production renderer. The
      // renderer was empirically ruled out as the Bug B smear cause
      // (ADR-108: WebGL and DOM both smeared, Canvas was incompatible —
      // the corruption is in the buffer model, not the GPU atlas). The
      // try/catch keeps the Canvas/DOM fallback for headless test envs
      // (jsdom), browsers with WebGL disabled, and GPU-blacklisted hosts.
      try {
        term.loadAddon(new WebglAddon());
      } catch (err) {
        console.warn(
          "[EmbeddedTerminal] WebGL renderer unavailable — falling back to Canvas/DOM:",
          err instanceof Error ? err.message : String(err),
        );
      }
      term.open(container);
      // v0.9.2 (ADR-084) — reset disposedRef in case StrictMode re-runs
      // this mount-effect (the cleanup function flipped it to true on the
      // previous unmount; React preserves useRef across mounts).
      disposedRef.current = false;
      // resume-cta-rework — a freshly mounted component owns a fresh
      // pty; re-arm the one-shot auto-inject guard.
      launchInjectedThisPtyLifetimeRef.current = false;
      // fix-resume-guard-survives-reload — a freshly mounted component
      // re-evaluates the reused-pty signal from scratch.
      ptyReusedGuardEvaluatedRef.current = false;
      // ADR-108 — defensively reset the replay drain gate on (re-)mount.
      // The completion callback, watchdog and synchronous-throw catch
      // release it on every reachable path; this guards the theoretical
      // case where a prior xterm was disposed with a snapshot write still
      // queued (xterm drops the completion callback) so a stale closed
      // gate cannot leak into a fresh xterm instance.
      resetReplayGate();
      // Initial fit. safeFit returns false if the renderer isn't yet ready
      // (pre-first-frame zero cell dims) — that's fine, the ResizeObserver
      // will fire as soon as the container settles.
      safeFit(fit, term, disposedRef.current);

      termRef.current = term;
      fitAddonRef.current = fit;
      // Iterate v0.8.6 AC-2 diagnostics — expose the active xterm
      // instance on window so Playwright can read `term.buffer.active`
      // line counts (scrollback INCLUDED — `.xterm-rows` only carries
      // the visible viewport, which masks scrollback accumulation).
      // Cleanup nulls it on dispose. Single ref, no production impact.
      (window as unknown as { __embeddedTerminal?: Terminal | null }).__embeddedTerminal = term;

      // iterate-2026-05-18 (FR-01.28) — keyboard copy/paste. Registered
      // once per xterm instance; runs before xterm's own key handling.
      // Paste routes through term.paste() → the onData handler below, so
      // the key handler needs no socket reference (no stale closure).
      term.attachCustomKeyEventHandler(
        createClipboardKeyHandler({
          term,
          isDisposed: () => disposedRef.current,
          notify: setClipboardNotice,
          copy: copyText,
          readClipboard: readClipboardForPaste,
        }),
      );

      // iterate-2026-05-25-fix-terminal-touch-scroll — one-finger pan-to-scroll.
      // xterm 6.x's `.xterm-scrollable-element` listens to `wheel` events but
      // registers no `touch*` listeners, so finger drag on a touchscreen did
      // nothing while a mouse wheel worked. attachTouchScroll fills the gap;
      // disposeTouchScroll is torn down alongside the other listeners below.
      const disposeTouchScroll = attachTouchScroll(term, container);

      // iterate-2026-05-23 (terminal-selection-uxd) — copy-on-selection.
      // See `latestSelectionRef` / `lastCopiedSelectionRef` declarations
      // above for the rationale. Two-step pipeline:
      //   step 1 — `onSelectionChange` (xterm-side) cheaply tracks the
      //     current selection on every drag-progress tick.
      //   step 2 — native `mouseup` / `keyup` on `term.element`
      //     (browser-side, INSIDE the trusted user activation window)
      //     flushes the latest tracked value to the OS clipboard via
      //     `copyText` if (a) it's non-empty after trim, and (b) it
      //     differs from the last copy.
      //
      // `copyText` already handles secure-context vs `execCommand`
      // fallback (`lib/clipboard.ts`). Failures are silent — auto-copy
      // is best-effort UX; the explicit Ctrl+C path still surfaces
      // `copy-failed` for non-recoverable cases.
      const onSelectionChangeDispose = term.onSelectionChange(() => {
        if (disposedRef.current) return;
        // term.getSelection() is the canonical xterm read — it handles
        // alt-buffer, wrapping, and OS-line-ending normalisation. Don't
        // try to introspect the buffer directly here.
        try {
          const sel = term.getSelection();
          latestSelectionRef.current = sel;
          // External-review code-mode round 3, MED #1: when the
          // selection lifecycle ENDS (xterm fires onSelectionChange
          // with an empty selection, e.g. after a non-drag click or
          // explicit clearSelection), reset the dedup so a subsequent
          // re-selection of the same text DOES copy again. Without
          // this, copying "foo", clicking elsewhere, then re-selecting
          // "foo" silently no-ops forever.
          if (!sel || sel.trim().length === 0) {
            lastCopiedSelectionRef.current = "";
          }
        } catch {
          // term may be mid-dispose; ignore.
        }
      });

      // Capture `term.element` at attach time — xterm sets this during
      // `term.open(container)` and only nulls it on dispose (which runs
      // our cleanup below). The MutationObserver, the mousedown-origin
      // tracker, and the keyup focus gate all key off this reference.
      const termElement = term.element;
      // Iterate-2026-05-23 (external-review code-mode round 2, both
      // reviewers): the previous target-containment gate broke the
      // legitimate "drag started in terminal, released outside the
      // canvas" case (browser dispatches mouseup on whatever element
      // sits under the cursor at release, which for a drag-to-edge is
      // outside `term.element`). Replace with origin tracking:
      // mousedown sets `dragStartedInTerminalRef` when the press lands
      // in the terminal; the next mouseup (anywhere) consumes that
      // ref — so a drag-out copy succeeds while a stray mouseup
      // elsewhere with no preceding terminal mousedown is ignored.
      const dragStartedInTerminalRef = { current: false };

      const onTerminalMousedown = (event: Event) => {
        if (!termElement) return;
        const target = event.target as Node | null;
        // Always re-evaluate — set true if the press is inside the
        // terminal, false if it's outside. External-review code-mode
        // round 3 MED #2 (both reviewers): without the outside-clears
        // arm, a mousedown-inside followed by no-mouseup (alt-tab,
        // Escape, native context menu) leaves the flag stale. The
        // NEXT unrelated mousedown outside the terminal then would
        // not clear it, and the matching mouseup elsewhere would
        // wrongly consume the stale "drag started inside" signal.
        dragStartedInTerminalRef.current = !!(
          target && termElement.contains(target)
        );
      };

      const flushSelectionCopy = (event: Event) => {
        if (disposedRef.current) return;
        // Gate per event type:
        //   - mouseup: allow when the drag originated in the terminal
        //     (mousedown landed inside `term.element`). On any mouseup
        //     elsewhere with no prior terminal mousedown, refuse. This
        //     handles drag-to-edge (start inside, end outside) AND
        //     prevents a stale terminal selection from being harvested
        //     by an unrelated click on another pane.
        //   - keyup: gate on `document.activeElement` being inside
        //     `term.element` — i.e. the xterm helper-textarea has
        //     focus. Without this, any keystroke in another input
        //     would silently overwrite the OS clipboard with the
        //     terminal selection (external-review code-mode MED #2).
        if (event.type === "mouseup") {
          if (!dragStartedInTerminalRef.current) {
            const target = event.target as Node | null;
            if (!termElement || !target || !termElement.contains(target)) {
              return;
            }
          }
          // Consume the flag — the next mouseup must re-arm via a
          // fresh terminal-origin mousedown.
          dragStartedInTerminalRef.current = false;
        } else if (event.type === "keyup") {
          // External-review code-mode round 4 MED #2: a blanket
          // keyup-while-terminal-focused gate fires on EVERY key
          // release (Tab, Escape, ordinary typing), risking surprising
          // clipboard writes of stale terminal selection. Narrow to
          // Shift + arrow/Home/End/Page — the only keys xterm's
          // accessibility-mode keyboard selection plausibly uses to
          // extend a selection. Drag-select with the mouse remains
          // the primary flow (covered by the mouseup branch above).
          const ke = event as KeyboardEvent;
          if (!ke.shiftKey) return;
          if (!/^(Arrow|Home|End|Page)/.test(ke.key)) return;
          const active = document.activeElement;
          if (!termElement || !active || !termElement.contains(active)) return;
        }
        // Read DIRECTLY from xterm — `latestSelectionRef` is a hint
        // only. By the time our document-scope listener runs, xterm's
        // own MouseService has already finalised the selection (it
        // listens at document too, but registered first during
        // `term.open`), so `term.getSelection()` is the canonical and
        // up-to-date source.
        const t = termRef.current;
        let raw = "";
        try {
          if (t && t.hasSelection()) raw = t.getSelection();
        } catch {
          /* term mid-dispose */
        }
        if (!raw) raw = latestSelectionRef.current;
        if (!raw || raw.trim().length === 0) return;
        if (raw === lastCopiedSelectionRef.current) return;
        // Optimistically claim the dedup slot BEFORE the async write
        // resolves — a `mouseup` storm (two events firing before the
        // first promise settles) must not double-copy. On failure we
        // intentionally do NOT roll back: the explicit Ctrl+C path is
        // the supported retry, and the user can simply re-select.
        lastCopiedSelectionRef.current = raw;
        void copyText(raw).catch(() => {
          /* silent — see comment block above */
        });
      };

      // Attach all three listeners at DOCUMENT scope. The mousedown
      // captures interaction origin; mouseup/keyup are the flush
      // triggers gated as described above.
      document.addEventListener("mousedown", onTerminalMousedown);
      document.addEventListener("mouseup", flushSelectionCopy);
      document.addEventListener("keyup", flushSelectionCopy);

      // iterate-2026-05-23 (terminal-selection-uxd) — Shift+Drag
      // discoverability banner driven by xterm's `.enable-mouse-events`
      // class on `term.element`. xterm-core (`MouseService`) toggles
      // this whenever the foreground app enables DECSET 1000/1002/1003.
      // `MutationObserver` is the right primitive: synchronous-on-flush,
      // no polling, no internal-API peek.
      let mouseModeObserver: MutationObserver | null = null;
      if (termElement) {
        // Synchronous initial-state sync read — terminal mounted with
        // the class already on the element shows the banner immediately
        // (external-review MED-7).
        const initialActive = termElement.classList.contains(
          "enable-mouse-events",
        );
        if (initialActive) {
          setMouseEventsActive(true);
          setBannerDismissed(false);
        }
        mouseModeObserver = new MutationObserver(() => {
          if (disposedRef.current) return;
          const active = termElement.classList.contains("enable-mouse-events");
          // setMouseEventsActive is a setter — React de-dupes equal
          // updates, so per-mutation overhead is bounded even if xterm
          // does multiple class swaps in one frame.
          setMouseEventsActive((prev) => {
            if (active && !prev) {
              // off → on transition re-arms a previously dismissed banner.
              setBannerDismissed(false);
            }
            return active;
          });
        });
        mouseModeObserver.observe(termElement, {
          attributes: true,
          attributeFilter: ["class"],
        });
      }

      // Forward keystrokes / paste-text into the socket.
      const onDataDispose = term.onData((data) => {
        socket.send({ type: "data", payload: data });
      });

      // ResizeObserver keeps xterm column count in sync with the container.
      // Iterate v0.8.6 AC-2 — client-side dedupe of no-op resizes.
      // ConPTY emits a SIGWINCH-driven READLINE redraw on every
      // pty.resize call, even when dims are unchanged. The server-side
      // PtyManager.resize already dedupes; this layer prevents the
      // redundant WS message from being sent at all (cleaner traces +
      // smaller load when 6+ WS connections happen due to StrictMode
      // double-mount × revisit).
      let lastSentCols = -1;
      let lastSentRows = -1;
      const resizeAndSend = () => {
        // v0.9.2 (ADR-084) — safeFit short-circuits when disposed OR when
        // the renderer reports zero cell dims; either case means we have
        // nothing useful to send.
        if (!safeFit(fit, term, disposedRef.current)) return;
        const cols = term.cols;
        const rows = term.rows;
        if (cols === lastSentCols && rows === lastSentRows) return;
        lastSentCols = cols;
        lastSentRows = rows;
        socket.send({ type: "resize", cols, rows });
      };
      const ro = new ResizeObserver(() => {
        const now = Date.now();
        if (now - lastResizeAtRef.current >= RESIZE_THROTTLE_MS) {
          lastResizeAtRef.current = now;
          resizeAndSend();
        } else if (!lastResizePendingRef.current) {
          lastResizePendingRef.current = setTimeout(() => {
            lastResizeAtRef.current = Date.now();
            lastResizePendingRef.current = null;
            resizeAndSend();
          }, RESIZE_THROTTLE_MS);
        }
      });
      ro.observe(container);

      return () => {
        // v0.9.2 (ADR-084) — cleanup ordering matters. `disposedRef` is
        // flipped FIRST so any straggler async tail of OUR code (safeFit
        // call sites, throttled resize setTimeout) short-circuits in
        // `safeFit` before dereferencing the post-dispose nulled
        // `_renderService`. The wrapped try/catch is defense-in-depth;
        // the disposedRef gate is the primary guarantee for our paths.
        disposedRef.current = true;
        // ADR-108 — tear down the replay drain gate: cancel the watchdog,
        // drop the queue, bump the generation so a deferred snapshot
        // completion callback that fires post-unmount is a no-op.
        resetReplayGate();
        ro.disconnect();
        if (lastResizePendingRef.current) {
          clearTimeout(lastResizePendingRef.current);
          lastResizePendingRef.current = null;
        }
        onDataDispose.dispose();
        // iterate-2026-05-23 (terminal-selection-uxd) — tear down the
        // selection-change disposable, the native listeners and the
        // mouse-mode observer. Order vs term.dispose() below: doing
        // these FIRST avoids any chance of a late mouseup landing
        // after term.element is nulled by xterm's own dispose path.
        try {
          onSelectionChangeDispose.dispose();
        } catch {
          /* ignore — best-effort cleanup */
        }
        try {
          disposeTouchScroll();
        } catch {
          /* ignore — best-effort cleanup */
        }
        document.removeEventListener("mousedown", onTerminalMousedown);
        document.removeEventListener("mouseup", flushSelectionCopy);
        document.removeEventListener("keyup", flushSelectionCopy);
        if (mouseModeObserver) {
          mouseModeObserver.disconnect();
        }

        // v0.9.2 (ADR-084) — defensive against XTERM-INTERNAL async tails:
        // term.write / term.scrollToBottom / term.resize queue internal
        // RAF callbacks (`Viewport.syncScrollArea`, `Renderer.refresh`)
        // that fire LATER and access `_renderService.dimensions` via a
        // getter chain. xterm.dispose() nulls the underlying renderer
        // but does NOT cancel those queued callbacks, so the next
        // animation frame after dispose throws
        // `Cannot read properties of undefined (reading 'dimensions')`
        // from xterm_xterm.js Viewport.syncScrollArea.
        //
        // Pre-emptively stub the `dimensions` getter to return safe
        // zero-dim shapes BEFORE invoking term.dispose(). Straggler
        // Viewport / Renderer callbacks then compute scroll positions
        // against zero dims (harmless no-op) instead of throwing.
        //
        // The stub is bounded to dispose-time (this exact component
        // instance, about to be torn down) and uses private xterm
        // internals (_core, _renderService) under a try/catch so a
        // future xterm refactor breaks loudly via the catch instead
        // of permanently disabling resize. xterm version pinned to
        // @xterm/xterm@^6 (ADR-097: bumped from ^5 in Iterate I).
        try {
          type XtermInternalsForStub = {
            _renderService?: {
              dimensions?: unknown;
            };
          };
          const core = (term as unknown as { _core?: XtermInternalsForStub })._core;
          const rs = core?._renderService;
          if (rs) {
            const safeDims = {
              css: {
                cell: { width: 0, height: 0 },
                canvas: { width: 0, height: 0 },
              },
              device: {
                cell: { width: 0, height: 0 },
                canvas: { width: 0, height: 0 },
              },
            };
            Object.defineProperty(rs, "dimensions", {
              configurable: true,
              get: () => safeDims,
            });
          }
        } catch {
          /* getter may be non-configurable in future xterm; fall through */
        }

        // Per external code-review openai HIGH #2: do NOT swallow
        // term.dispose() failures. The dimensions-stub above prevents
        // the known xterm-internal async-tail throw; a separate dispose
        // failure would be a real correctness regression we WANT to
        // surface, not mask. Let unexpected errors propagate.
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
        (window as unknown as { __embeddedTerminal?: Terminal | null }).__embeddedTerminal = null;
      };
      // socket.send is stable via useCallback; we intentionally don't depend
      // on `socket` here because re-mounting xterm on every reconnect would
      // throw away scrollback. The send call uses the ref-routed websocket.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When the tab becomes active, re-fit (hidden containers report 0x0).
    // Iterate v0.8.6 AC-2 — dedupe no-op resize sends here too; same
    // rationale as the ResizeObserver path above.
    const lastActiveResizeRef = useRef<{ cols: number; rows: number }>({ cols: -1, rows: -1 });
    useEffect(() => {
      if (!active) return;
      const fit = fitAddonRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      // v0.9.2 (ADR-084) — same safeFit hardening as the ResizeObserver
      // path. If safeFit returns false (disposed / pre-renderer-ready)
      // we still emit a resize WS frame from `term.cols / term.rows` —
      // the term getter reads the current internal cols/rows which were
      // set on the last successful fit OR on construction (defaults
      // 120×30). That's a safe no-op vs. sending NaN dims.
      safeFit(fit, term, disposedRef.current);
      const cols = term.cols;
      const rows = term.rows;
      if (
        cols !== lastActiveResizeRef.current.cols ||
        rows !== lastActiveResizeRef.current.rows
      ) {
        lastActiveResizeRef.current = { cols, rows };
        socket.send({ type: "resize", cols, rows });
      }
    }, [active, socket]);

    // DOM paste handler (capture phase) — image-wins precedence per AC-6.
    //
    // Iterate v0.8.2 AC-3 (Ctrl+V parity with Alt+V): the listener is
    // attached to `document` instead of `container` so xterm's internal
    // textarea-level paste handling cannot pre-empt us. Capture phase on
    // document is the first DOM dispatch step, before any listener on
    // xterm's textarea or its parents. We still scope the handler with
    // `container.contains(target)` so it never reacts to pastes in
    // unrelated parts of the page.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const handler = (ev: ClipboardEvent) => {
        const target = ev.target as Node | null;
        if (!target || !container.contains(target)) return;

        const items = ev.clipboardData?.items;
        if (!items || items.length === 0) return;

        // Find first image item (image-wins precedence). Iterate v0.8.3
        // refactor — upload routed through the shared `uploadPasteBlob`
        // so this path stays in lock-step with the Ctrl+V keydown path.
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.kind === "file" && it.type.startsWith("image/")) {
            ev.preventDefault();
            ev.stopPropagation();
            const blob = it.getAsFile();
            if (!blob) return;
            void uploadPasteBlob(blob, `paste-${Date.now()}.png`);
            return;
          }
        }

        // No image: fall through to text-paste via socket.send (AC-6a).
        // External review F-v2: detect text-item presence INDEPENDENT of
        // empty-string truthiness — empty paste should still preventDefault
        // for predictable single-path behavior.
        const hasTextItem = Array.from(items).some(
          (it) => it.kind === "string" && it.type === "text/plain",
        );
        if (hasTextItem) {
          ev.preventDefault();
          ev.stopPropagation();
          const text = ev.clipboardData?.getData("text/plain") ?? "";
          // iterate-2026-05-18 (AC-8) — route through term.paste() so
          // line endings normalize and bracketed-paste markers wrap the
          // content; the prior raw socket.send made a multi-line prompt
          // submit on its first line.
          if (text && !disposedRef.current) {
            termRef.current?.paste(text);
          }
        }
      };
      document.addEventListener("paste", handler, { capture: true });
      return () => {
        document.removeEventListener(
          "paste",
          handler,
          { capture: true } as EventListenerOptions,
        );
      };
      // socket no longer referenced — paste now routes via term.paste()
      // (iterate-2026-05-18 AC-8); `termRef`/`disposedRef` are refs.
    }, [uploadPasteBlob]);

    // ADR-068-A1 AC-16 (Phase-5-Codex review fix): about-to-run preview
    // banner. Visible while a pendingLaunch token exists for THIS
    // EmbeddedTerminal (matches the user's clipboard-visual-gate
    // expectation). Shows the actual command bytes that will hit the
    // pty so the user has a chance to see what's about to execute.
    // For custom-action launches, the preview is non-collapsible —
    // bundled-action launches (the default) get a small spinner.
    const previewCommand =
      coord.pendingLaunch && socket.shellKind
        ? socket.shellKind === "pwsh"
          ? coord.pendingLaunch.commands.powershell
          : socket.shellKind === "cmd"
            ? coord.pendingLaunch.commands.cmd
            : coord.pendingLaunch.commands.posix
        : null;

    // resume-cta-rework (2026-05-16) — the parked command for the
    // explicit "Send to terminal" confirm banner (one-shot guard). Null
    // until a second launch lands on an already-used pty.
    const manualSendCommand =
      manualSendPending && socket.shellKind
        ? socket.shellKind === "pwsh"
          ? manualSendPending.commands.powershell
          : socket.shellKind === "cmd"
            ? manualSendPending.commands.cmd
            : manualSendPending.commands.posix
        : null;

    // ADR-104 (iterate-20260515-terminal-smear-reset) — reset banner.
    // Surfaced when the WS attach freshly re-created the pty after a
    // prior Claude session was lost (server restart / crash — see
    // `deriveTerminalReset` in server/src/terminal/routes.ts). Hidden
    // once a launch is dispatched (`pendingLaunch` set — the about-to-run
    // preview banner takes over) or the user dismisses it.
    const showResetBanner =
      socket.terminalReset === true &&
      !coord.pendingLaunch &&
      !resetBannerDismissed;

    return (
      // Iterate v0.8.5 AC-1 — single-layer wrapper carries the dark
      // background AND the inner padding. v0.8.3 had only `p-2 rounded-md`
      // (no bg-color) which produced an 8px ring of parent surface +
      // xterm flush against the dark edge. v0.8.5 simplifies: black
      // extends to the wrapper edge (no outer ring), text/cursor sits
      // 8px inset on all four sides via inner padding. xterm's FitAddon
      // picks up the padded inner box via ResizeObserver.
      //
      // v0.8.6 AC-1 — rounded corners dropped (`rounded-md` was visually
      // out of place against the rest of the WebUI's square chrome).
      // Same with the banner `rounded-t-md` below.
      //
      // Conditional banners (read-only / replay-only / preview-command)
      // span full wrapper width via negative margin (`-mx-2 -mt-2 mb-2`)
      // so they read as a header strip ON the dark frame, not an
      // island floating inside the padding.
      <div
        className="relative flex h-full min-h-0 w-full flex-col bg-[#1a1a1a] p-2"
        data-testid="embedded-terminal"
        data-ws-open={socket.open ? "true" : "false"}
        data-ws-ready={socket.ready ? "true" : "false"}
        data-role={socket.role ?? "unknown"}
      >
        {readOnly ? (
          <div
            className="-mx-2 -mt-2 mb-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
            data-testid="embedded-terminal-readonly"
          >
            Read-only — another tab is the active writer for this task.
          </div>
        ) : null}
        {showResetBanner ? (
          // ADR-104 — terminal-reset banner. The pty was freshly
          // re-created after a prior Claude session was lost; tell the
          // user to Resume instead of leaving them at a silent shell.
          <div
            className="-mx-2 -mt-2 mb-2 flex items-start justify-between gap-2 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
            data-testid="embedded-terminal-reset"
          >
            <span>
              Terminal was reset — the previous Claude session was
              interrupted (the server may have restarted). Click{" "}
              <strong>Resume</strong> to continue.
            </span>
            <button
              type="button"
              onClick={() => setResetBannerDismissed(true)}
              className="shrink-0 rounded px-1 leading-none text-[var(--color-warning,#9a3412)] hover:bg-black/5"
              data-testid="embedded-terminal-reset-dismiss"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ) : null}
        {socket.replayOnly === true ? (
          // Iterate v0.8.2 AC-7 — replay-only banner. Server bypassed
          // pty spawn because the task is in a terminal state (`done` /
          // `launch_failed`); the WS only serves the historical
          // scrollback and then closes.
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
          // resume-cta-rework (2026-05-16) — confirm-on-reuse banner.
          // The one-shot guard fired: this pty already had a launch
          // injected, so auto-run is suppressed. The command sits here
          // behind an explicit "Send to terminal" button so it can
          // never land inside a running Claude session.
          <div
            className="-mx-2 -mt-2 mb-2 flex flex-col gap-1 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1.5 text-[11px] text-[var(--color-warning,#9a3412)]"
            data-testid="embedded-terminal-manual-send"
          >
            <div className="flex items-start justify-between gap-2">
              <span>
                This terminal already has a session — auto-run is
                disabled so the command can't land inside a running
                Claude. Send it only when the shell is back at a prompt.
              </span>
              <button
                type="button"
                onClick={() => setManualSendPending(null)}
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
                onClick={handleManualSend}
                className="shrink-0 rounded bg-[var(--color-warning,#9a3412)] px-2 py-0.5 font-semibold text-white transition hover:opacity-90"
                data-testid="embedded-terminal-manual-send-button"
              >
                Send to terminal
              </button>
            </div>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-hidden"
          tabIndex={-1}
          data-testid="embedded-terminal-canvas"
        />
        {mouseEventsActive && !bannerDismissed ? (
          // iterate-2026-05-23 (terminal-selection-uxd) — Shift+Drag
          // discoverability badge. Renders only when xterm-core has
          // toggled `.enable-mouse-events` on `term.element` (i.e. the
          // foreground app — usually Claude TUI — is consuming mouse
          // events and so blocking drag-select). Top-RIGHT position so
          // it does not collide with the bottom-right clipboard notice.
          // `pointer-events-auto` on the badge itself (default) means
          // the rest of the top-right area still passes clicks through
          // to xterm. The dismiss button's `onMouseDown` prevents focus
          // theft (external review MED-3 / gemini).
          <div
            className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded border border-sky-800 bg-[#0f1d2e] px-2.5 py-1 text-[11px] text-sky-300 shadow-md"
            data-testid="embedded-terminal-mouse-mode-hint"
            role="status"
          >
            <span>Maus-Modus aktiv — Shift+Drag zum Markieren</span>
            <button
              type="button"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => setBannerDismissed(true)}
              className="shrink-0 rounded px-1 leading-none hover:bg-white/10"
              data-testid="embedded-terminal-mouse-mode-hint-dismiss"
              aria-label="Hinweis schließen"
            >
              ✕
            </button>
          </div>
        ) : null}
        {clipboardNotice ? (
          // iterate-2026-05-18 — copy/paste notice. Absolute corner pill
          // so it never reflows xterm or stacks with the header banners.
          <div
            className={`absolute bottom-3 right-3 z-10 flex max-w-[min(90%,28rem)] items-center gap-2 rounded border px-2.5 py-1 text-[11px] shadow-md ${CLIPBOARD_NOTICE_CLASS[clipboardNotice]}`}
            data-testid="embedded-terminal-clipboard-notice"
            data-notice-kind={clipboardNotice}
          >
            <span>{CLIPBOARD_NOTICE_TEXT[clipboardNotice]}</span>
            {clipboardNotice !== "copied" ? (
              <button
                type="button"
                onClick={() => setClipboardNotice(null)}
                className="shrink-0 rounded px-1 leading-none hover:bg-white/10"
                data-testid="embedded-terminal-clipboard-notice-dismiss"
                aria-label="Dismiss"
              >
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);
