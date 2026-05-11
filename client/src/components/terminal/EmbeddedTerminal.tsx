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
 *   - Text-only clipboard: preventDefault + socket.send({type:"data", payload}).
 *   - Mixed clipboard: image wins; text dropped intentionally.
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
import "@xterm/xterm/css/xterm.css";

import {
  useTerminalSocket,
  type TerminalRole,
} from "../../hooks/useTerminalSocket";
import { useLaunchCoordinator } from "../../contexts/LaunchCoordinatorContext";
import { EMBEDDED_TERMINAL_PALETTE } from "./terminal-theme";

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
 * xterm version pinned to @xterm/xterm@^5 (see client/package.json).
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
    }, [taskId]);

    const socket = useTerminalSocket({
      taskId,
      urlOverride: socketUrlOverride,
      enabled: socketEnabled,
      onData: (chunk) => {
        // Track quiet-period for prompt-readiness handshake. Any pty.onData
        // burst counts as activity and resets the 250ms quiesce window.
        if (!dataSeenInitiallyRef.current) dataSeenInitiallyRef.current = true;
        lastPtyDataAtRef.current = Date.now();
        termRef.current?.write(chunk);
      },
      onReplaySnapshot: ({ data, terminalVersion }) => {
        // ADR-087/089 — single-envelope cell-state replay. The server
        // has already stabilised the payload via M2 double-serialize, so
        // the client writes ONCE into xterm. ADR-079 pushdown +
        // ADR-077 banner-grace + ADR-086 skip-for-new-plain were all
        // legacy byte-stream compensations and have been retired in
        // Iterate C — the cell-state path does NOT exhibit any of
        // those problems by construction.
        const term = termRef.current;
        if (!term) return;
        // Best-effort version-family check. Server's version gate is the
        // authoritative accept/reject layer; this is just a console
        // warning when minor versions drift across the same major.
        if (terminalVersion) {
          try {
            const major = terminalVersion.split(".")[0];
            if (major && major !== "5") {
              // eslint-disable-next-line no-console
              console.warn(
                `[terminal] replay_snapshot served by xterm major ${major}; client xterm.js is major 5 — visual artifacts possible`,
              );
            }
          } catch {
            /* ignore */
          }
        }
        try {
          // Use `term.reset()` (not `clear()`) — `clear()` only wipes
          // scrollback above the viewport; `reset()` re-initialises
          // cursor + viewport + scrollback so the snapshot writes into
          // a truly fresh state on re-attach.
          try {
            term.reset();
          } catch {
            /* xterm mid-dispose; ignore */
          }
          term.write(data);
          term.scrollToBottom();
        } catch (err) {
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
        coord.consumeLaunch(pending.launchToken);
      })().finally(() => {
        injectionInFlightRef.current = false;
      });

      return () => {
        cancelled = true;
      };
    }, [coord, socket.ready, socket.role, socket.shellKind, coord.pendingLaunch]);

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
        scrollback: 5000,
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);
      term.open(container);
      // v0.9.2 (ADR-084) — reset disposedRef in case StrictMode re-runs
      // this mount-effect (the cleanup function flipped it to true on the
      // previous unmount; React preserves useRef across mounts).
      disposedRef.current = false;
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
        ro.disconnect();
        if (lastResizePendingRef.current) {
          clearTimeout(lastResizePendingRef.current);
          lastResizePendingRef.current = null;
        }
        onDataDispose.dispose();

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
        // @xterm/xterm@^5.
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
          if (text) socket.send({ type: "data", payload: text });
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
    }, [uploadPasteBlob, socket]);

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
        className="flex h-full min-h-0 w-full flex-col bg-[#1a1a1a] p-2"
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
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-hidden"
          tabIndex={-1}
          data-testid="embedded-terminal-canvas"
        />
      </div>
    );
  },
);
