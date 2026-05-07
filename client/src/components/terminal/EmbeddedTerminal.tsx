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
import {
  readClipboardForPaste,
  shouldInterceptCtrlV,
} from "./clipboard-paste";

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
      onBackpressure: (info) => {
        onBackpressure?.(info);
      },
    });

    // Derive the read-only state from socket.role — flipping cleanly
    // when the server promotes us via the writer-promoted envelope
    // (closes the StrictMode double-mount race; the previous local
    // setReadOnly(true) state never cleared on promotion).
    const readOnly = socket.role === "reader";

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

    // Iterate v0.8.3 AC-1 — shared image-upload helper + Ctrl+V handler.
    //
    // v0.8.2 moved the DOM `paste` listener to document/capture-phase,
    // but real-browser Ctrl+V never reached it: xterm's keybinding
    // bypasses ClipboardEvent and uses async `navigator.clipboard.readText()`,
    // which resolves to text only — image-paste from a bare PowerShell
    // prompt landed nowhere. The fix installs `attachCustomKeyEventHandler`
    // that suppresses xterm's Ctrl+V default and drives the structured
    // `navigator.clipboard.read()` API ourselves. Both paths (DOM `paste`
    // event AND Ctrl+V keydown) route image blobs through `uploadPasteBlob`
    // so success / error / gitignore surfaces stay consistent.
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

    // Ctrl+V key-handler ref. Updated whenever upstream callbacks /
    // socket change so the closure injected into xterm always sees the
    // latest versions without re-mounting xterm itself (which would
    // discard scrollback). The xterm-mount useEffect (deps: []) reads
    // this ref via `attachCustomKeyEventHandler` exactly once.
    const ctrlVHandlerRef = useRef<(ev: KeyboardEvent) => boolean>(() => true);
    useEffect(() => {
      ctrlVHandlerRef.current = (ev: KeyboardEvent): boolean => {
        if (!shouldInterceptCtrlV(ev)) return true;
        // Firefox / non-secure-context fallback: if structured clipboard
        // read is unavailable, let xterm's own Ctrl+V (text-only via
        // readText) run unchanged. We intentionally do NOT preventDefault
        // here so the historical behaviour stays intact.
        if (
          typeof navigator === "undefined" ||
          typeof navigator.clipboard?.read !== "function"
        ) {
          return true;
        }
        ev.preventDefault();
        ev.stopPropagation();
        void (async () => {
          const payload = await readClipboardForPaste(navigator);
          if (payload.kind === "image") {
            await uploadPasteBlob(payload.blob, payload.filename);
            return;
          }
          if (payload.kind === "text") {
            if (payload.text) {
              socket.send({ type: "data", payload: payload.text });
            }
            return;
          }
          if (payload.kind === "error") {
            onPasteImageError?.(payload.detail);
            return;
          }
          // 'empty' / 'unsupported' → silent fall-through. Empty
          // clipboard is normal user behaviour; 'unsupported' is
          // already gated above (we returned true before suppressing).
        })();
        return false;
      };
    }, [uploadPasteBlob, socket, onPasteImageError]);

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
      try {
        fit.fit();
      } catch {
        /* container may not have non-zero size yet */
      }

      // Iterate v0.8.3 AC-1 — install the Ctrl+V interceptor. The
      // closure forwards to `ctrlVHandlerRef.current` so updates to
      // upstream callbacks / socket take effect without remounting
      // xterm (which would discard scrollback). Returning true keeps
      // xterm processing the key normally; returning false suppresses
      // xterm's default and we drive navigator.clipboard.read()
      // ourselves.
      term.attachCustomKeyEventHandler((ev) => ctrlVHandlerRef.current(ev));

      termRef.current = term;
      fitAddonRef.current = fit;

      // Forward keystrokes / paste-text into the socket.
      const onDataDispose = term.onData((data) => {
        socket.send({ type: "data", payload: data });
      });

      // ResizeObserver keeps xterm column count in sync with the container.
      const resizeAndSend = () => {
        try {
          fit.fit();
        } catch {
          return;
        }
        const cols = term.cols;
        const rows = term.rows;
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
        ro.disconnect();
        if (lastResizePendingRef.current) {
          clearTimeout(lastResizePendingRef.current);
          lastResizePendingRef.current = null;
        }
        onDataDispose.dispose();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
      // socket.send is stable via useCallback; we intentionally don't depend
      // on `socket` here because re-mounting xterm on every reconnect would
      // throw away scrollback. The send call uses the ref-routed websocket.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When the tab becomes active, re-fit (hidden containers report 0x0).
    useEffect(() => {
      if (!active) return;
      const fit = fitAddonRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      socket.send({ type: "resize", cols: term.cols, rows: term.rows });
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
      // Iterate v0.8.3 AC-2 — outer padding so the xterm canvas does not
      // hug the pane edge. `p-2` (8px) + `rounded-md` give a small visual
      // breathing room; xterm's FitAddon picks up the padded inner box
      // automatically via ResizeObserver. Inherits the dark background
      // from xterm itself — no parent bg override is necessary because
      // the `bg-[var(--color-surface)]` of TaskDetailPage's tab content
      // shows through the padding strip.
      <div
        className="flex h-full min-h-0 w-full flex-col p-2 rounded-md"
        data-testid="embedded-terminal"
        data-ws-open={socket.open ? "true" : "false"}
        data-ws-ready={socket.ready ? "true" : "false"}
        data-role={socket.role ?? "unknown"}
      >
        {readOnly ? (
          <div
            className="border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-warning-bg,#fff7ed)] px-3 py-1 text-[11px] text-[var(--color-warning,#9a3412)]"
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
            className="border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-3 py-1 text-[11px] text-[var(--color-muted,#6b7280)]"
            data-testid="embedded-terminal-replay-only"
          >
            Session ended — viewing historical terminal scrollback only.
          </div>
        ) : null}
        {previewCommand ? (
          <div
            className="border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-info-bg,#eff6ff)] px-3 py-1 font-mono text-[11px] text-[var(--color-info,#1d4ed8)]"
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
