/*
 * TaskDetailPage — thin composition shell for the 3-pane task detail
 * surface (iterate 3 section 04, AD-03.06 + FR-03.30..36; visual rebuild
 * in iterate 3.7b-3 / Phase B3).
 *
 * Multi-file viewer: `selectedPaths` is the tab list (dedup order
 * preserving). `activePath` is the currently-rendered file in the right
 * pane. Clicking a folder-tree row adds the path to the array (if new)
 * and activates it; closing a tab from the ViewerTabBar removes it, then
 * falls back to the last-remaining path or `null` when the array empties.
 *
 * Transcript pane header: derives user-facing counts (events, tool uses,
 * pending AskUserQuestion) from the parsed transcript — the debug
 * status/fingerprint/size display moved behind the header's "Show
 * session details" toggle.
 *
 * Regression guards:
 *   - No chat composer (DO-NOT #3).
 *   - No webui-initiated `claude --resume` (DO-NOT #5).
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";

import { useExternalTask } from "../hooks/useExternalTasks";
import { useTaskTranscript } from "../hooks/useTaskTranscript";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { BubbleTranscript } from "../components/external/BubbleTranscript";
import { TaskDetailHeader } from "../components/external/TaskDetailHeader";
import { TaskDetailThreePane } from "../components/external/TaskDetailThreePane";
import { FolderTree } from "../components/external/FolderTree";
import { SmartViewer } from "../components/external/SmartViewer";
import { ViewerTabBar } from "../components/external/SmartViewer/ViewerTabBar";
import { parseSessionJsonl, toolUses } from "../external/session-parser";
import {
  LaunchCoordinatorProvider,
  useLaunchCoordinator,
} from "../contexts/LaunchCoordinatorContext";

// Lazy-load the xterm bundle so the ~120 KB gz only ships when a TaskDetail
// actually opens (external review F6).
const EmbeddedTerminal = lazy(() =>
  import("../components/terminal/EmbeddedTerminal").then((m) => ({
    default: m.EmbeddedTerminal,
  })),
);

import type { EmbeddedTerminalHandle } from "../components/terminal/EmbeddedTerminal";

type CenterTab = "transcript" | "terminal";
const TAB_STORAGE_KEY = "webui:embedded-terminal-default-tab";

export default function TaskDetailPage() {
  // Wrap the entire body in LaunchCoordinatorProvider so the auto-launch
  // pendingLaunch state is scoped to ONE page mount (ADR-068-A1 Decision
  // #17 — page-unmount cancels any in-flight pending launch).
  return (
    <LaunchCoordinatorProvider>
      <TaskDetailPageBody />
    </LaunchCoordinatorProvider>
  );
}

/**
 * Compact privacy disclosure for the Terminal tab — ADR-068-A1 AC-15.
 *
 * Renders as a 1-line dismissible note at the bottom of the embedded
 * terminal pane. The user toggles it off via the × button; preference
 * persists in localStorage. Copy includes:
 *   - retention period
 *   - "may contain secrets" warning
 *   - Windows-permission-best-effort note (when on Windows)
 *   - "Clear history" pointer (route through "..." menu)
 *
 * Display-only — there's no client-side state about whether scrollback
 * actually exists for this task. The note is a privacy notice, not a
 * runtime indicator.
 */
function PrivacyDisclosureFooter() {
  const STORAGE_KEY = "webui:terminal-privacy-disclosure-dismissed";
  const [dismissed, setDismissed] = useLocalStorage<boolean>(STORAGE_KEY, false);
  if (dismissed) return null;
  const isWindows = typeof navigator !== "undefined" &&
    /windows/i.test(navigator.userAgent);
  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex items-center gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] px-3 py-1.5 text-[11px] text-[var(--color-muted,#6b7280)]"
      data-testid="terminal-privacy-disclosure"
    >
      <span aria-hidden>ⓘ</span>
      <span className="flex-1 truncate">
        Terminal scrollback is persisted locally (default 24h retention,
        configurable via <code>SHIPWRIGHT_TERMINAL_SCROLLBACK_TTL_DAYS</code>;
        may include secrets / env vars).{" "}
        {isWindows ? (
          <span>On Windows, file permissions rely on user-account ACLs.</span>
        ) : null}
        {" "}Use the <code className="rounded bg-[var(--color-muted-bg,#ede8e1)] px-1">⋮ → Clear terminal history</code> menu to remove.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[var(--color-muted,#6b7280)] hover:text-[var(--color-text,#1a1a1a)]"
        data-testid="terminal-privacy-disclosure-dismiss"
        aria-label="Dismiss privacy notice"
      >
        ×
      </button>
    </div>
  );
}

function TaskDetailPageBody() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, error } = useExternalTask(taskId);
  const transcript = useTaskTranscript(taskId ?? null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const coord = useLaunchCoordinator();

  // Center-pane Toggle-Tab (ADR-067). Persisted globally per user
  // preference — once a user picks Terminal, every TaskDetail they
  // open lands on Terminal until they pick Transcript again.
  const [centerTab, setCenterTab] = useLocalStorage<CenterTab>(
    TAB_STORAGE_KEY,
    "terminal",
  );
  const terminalRef = useRef<EmbeddedTerminalHandle | null>(null);

  // ADR-068-A1: when a pendingLaunch is dispatched (by TaskDetailHeader's
  // CTA), flip to the Terminal tab + mark a focus pending. The
  // EmbeddedTerminal then consumes pendingLaunch via context, awaits
  // the prompt-readiness handshake, and writes commands[shellKind]+"\r"
  // over the WS — replacing the old `webui:launch-copied` window-event
  // round-trip.
  const [pendingFocus, setPendingFocus] = useState(false);
  useEffect(() => {
    if (!coord.pendingLaunch) return;
    setCenterTab("terminal");
    setPendingFocus(true);
  }, [coord.pendingLaunch, setCenterTab]);

  // Phase-5-Codex review fix (HIGH): "Terminal" CTA on active/awaiting
  // tasks dispatches `webui:focus-terminal-tab` (pure tab-flip, no
  // auto-execute). Listener flips the Tabs.Root + focuses xterm.
  useEffect(() => {
    const handler = () => {
      setCenterTab("terminal");
      setPendingFocus(true);
    };
    window.addEventListener("webui:focus-terminal-tab", handler);
    return () =>
      window.removeEventListener("webui:focus-terminal-tab", handler);
  }, [setCenterTab]);

  // Phase-3 review fix (HIGH) reverted (live-smoke 2026-05-05):
  // The explicit `useEffect(() => () => coord.cancelLaunch("page-unmount"), [])`
  // pattern was BROKEN by React 19 StrictMode dev mode, which fires
  // mount → cleanup → mount on every effect. The cleanup-fired
  // cancelLaunch immediately cancelled any pendingLaunch that another
  // effect (sessionStorage handover OR Launch CTA dispatch) had just
  // set, AND the second mount of the sessionStorage-read effect found
  // an empty entry (already consumed by the first mount) so it could
  // not recover. Result: auto-launch never fires in dev.
  //
  // The LaunchCoordinatorProvider's React state naturally GCs on
  // unmount, so an explicit cancel is not strictly required — the
  // provider's setState would have no observers to notify anyway. We
  // accept the deviation from AC-5 (deterministic cancel-reason
  // tracking on page-unmount) in favor of working dev-mode auto-launch.
  // The 30s pendingTimeoutMs inside the provider catches stale
  // launches if the page somehow ever holds a pending across an
  // unmount-without-real-unmount cycle.

  // Live-smoke fix (2026-05-05): pick up a pending-auto-launch handed
  // over from NewIssueModal via sessionStorage. The modal POSTs /launch
  // (server state transitions to awaiting_external_start) but stores
  // the commands in sessionStorage instead of writing to clipboard.
  // Dispatch them here so the EmbeddedTerminal injection effect picks
  // up the auto-execute. Idempotent — sessionStorage entry removed
  // after first read.
  useEffect(() => {
    if (!taskId) return;
    if (typeof window === "undefined") return;
    const key = `webui:pending-auto-launch:${taskId}`;
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        commands?: { powershell: string; cmd: string; posix: string };
        resume?: boolean;
        ts?: number;
      };
      // Drop entries older than 60s — defensive against stale entries
      // from a long-ago modal session.
      if (parsed.ts && Date.now() - parsed.ts > 60_000) {
        window.sessionStorage.removeItem(key);
        return;
      }
      if (parsed.commands) {
        coord.dispatchAutoLaunch(parsed.commands, parsed.resume === true);
      }
    } catch {
      // malformed entry — remove + skip
    } finally {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    // Run once on mount per taskId; the coord dispatch + EmbeddedTerminal
    // effect handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Drives the readiness handshake: when the terminal reports ready=true
  // and a focus is pending, focus xterm. Single retry on next ready
  // transition keeps it simple — no busy loop. Reader-role tabs cancel
  // any pending launch so it cannot fire later.
  //
  // 2026-05-05 — Reader-cancel race fix: when a NEW WS attaches to an
  // EXISTING pty (StrictMode double-mount → first connection's cleanup
  // races with second connection's open; or genuine multi-tab handoff),
  // the server emits `ready{role:"reader"}` followed within ~5ms by
  // `writer-promoted` once the previous writer's close finalizes.
  // Cancelling immediately on the first reader-signal kills auto-launch
  // 50% of the time. Instead, defer the cancel by a stability window
  // (1500ms — typical promotion is <50ms; a real second-tab will stay
  // reader well beyond that). If `socket.role` flips to "writer" before
  // the timeout fires, the timeout is cleared — see effect below.
  const READER_CANCEL_STABILITY_MS = 1500;
  const readerCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTerminalReady = useCallback(
    (ready: boolean, role: import("../hooks/useTerminalSocket").TerminalRole | null) => {
      if (ready && role === "reader" && coord.pendingLaunch) {
        if (readerCancelTimerRef.current === null) {
          readerCancelTimerRef.current = setTimeout(() => {
            readerCancelTimerRef.current = null;
            const handle = terminalRef.current;
            // Re-check role at firing time — promotion may have landed.
            if (handle?.role === "reader") {
              coord.cancelLaunch("role-not-writer");
            }
          }, READER_CANCEL_STABILITY_MS);
        }
      } else if (readerCancelTimerRef.current !== null) {
        // Role flipped away from reader (typically → writer); abort the cancel.
        clearTimeout(readerCancelTimerRef.current);
        readerCancelTimerRef.current = null;
      }
      if (!ready) return;
      if (!pendingFocus) return;
      const handle = terminalRef.current;
      if (!handle) return;
      handle.focus();
      setPendingFocus(false);
    },
    [pendingFocus, coord],
  );
  useEffect(() => {
    return () => {
      if (readerCancelTimerRef.current !== null) {
        clearTimeout(readerCancelTimerRef.current);
        readerCancelTimerRef.current = null;
      }
    };
  }, []);

  // .gitignore-suggestion toast (ADR-067 AC-8). EmbeddedTerminal fires
  // onGitignoreSuggestion when a paste-image response carries
  // gitignoreSuggestion=true. The toast offers a one-click append.
  const [gitignoreToastOpen, setGitignoreToastOpen] = useState(false);
  const [gitignoreAppending, setGitignoreAppending] = useState(false);
  const [gitignoreError, setGitignoreError] = useState<string | null>(null);
  const [pasteImageError, setPasteImageError] = useState<string | null>(null);
  const handleGitignoreSuggestion = useCallback(() => {
    setGitignoreToastOpen(true);
    setGitignoreError(null);
  }, []);
  // External review F-v2: surface paste-image upload failures instead of
  // swallowing them. Auto-dismiss after 4 s so the toast doesn't stick.
  const handlePasteImageError = useCallback((detail: string) => {
    setPasteImageError(detail);
    window.setTimeout(() => setPasteImageError((curr) => (curr === detail ? null : curr)), 4000);
  }, []);
  const handleGitignoreAppend = useCallback(async () => {
    if (!taskId) return;
    setGitignoreAppending(true);
    setGitignoreError(null);
    try {
      // External code-review F9: only dismiss the toast on success.
      // Past version dismissed regardless, masking 4xx/5xx so the user
      // never learned the append didn't happen.
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(taskId)}/append-gitignore`,
        { method: "POST" },
      );
      if (res.ok) {
        setGitignoreToastOpen(false);
      } else {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; detail?: string } | null;
          if (body?.error) detail = body.error;
        } catch {
          /* fall back to status code */
        }
        setGitignoreError(detail);
      }
    } catch (err) {
      setGitignoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setGitignoreAppending(false);
    }
  }, [taskId]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  }, []);

  const handleCloseTab = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      // If the closed tab was active, fall back to the last remaining tab
      // (or null when the list empties).
      setActivePath((prevActive) => {
        if (prevActive !== path) return prevActive;
        return next.length > 0 ? next[next.length - 1] : null;
      });
      return next;
    });
  }, []);

  // Derived transcript stats, used by the center-pane header.
  const transcriptStats = useMemo(() => {
    if (!transcript.content) {
      return { events: 0, toolUses: 0, pending: 0 };
    }
    const { events } = parseSessionJsonl(transcript.content);
    let tools = 0;
    for (const e of events) {
      if (e.kind === "assistant") {
        tools += toolUses(e).length;
      }
    }
    const pending = task?.inbox?.pendingToolUseIds?.length ?? 0;
    return { events: events.length, toolUses: tools, pending };
  }, [transcript.content, task?.inbox?.pendingToolUseIds]);

  if (error) {
    return (
      <div
        className="p-4 text-sm text-[var(--color-error,#DC2626)]"
        data-testid="task-detail-error"
      >
        Error loading task: {String(error)}
      </div>
    );
  }
  if (!task) {
    return (
      <div
        className="p-4 text-sm text-[var(--color-muted,#6b7280)]"
        data-testid="task-detail-loading"
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="task-detail-page"
      style={{ background: "var(--color-bg, #f5f0eb)" }}
    >
      <TaskDetailHeader task={task} />

      <div className="min-h-0 flex-1">
        <TaskDetailThreePane
          left={
            <FolderTree
              projectId={task.projectId}
              selectedPath={activePath}
              onSelect={handleSelect}
            />
          }
          center={
            <section
              className="flex h-full min-h-0 flex-col"
              style={{ background: "var(--color-bg, #f5f0eb)" }}
              data-testid="task-detail-center"
            >
              <Tabs.Root
                value={centerTab}
                onValueChange={(v) => setCenterTab(v as CenterTab)}
                className="flex h-full min-h-0 flex-col"
              >
                <div
                  className="flex min-h-[40px] items-center justify-between gap-3 border-b border-[var(--color-border,#e0dbd4)] px-4 py-2 text-[11px]"
                  style={{
                    background: "var(--color-surface, #ffffff)",
                    color: "var(--color-muted, #6b7280)",
                  }}
                  data-testid="task-detail-center-header"
                >
                  <Tabs.List
                    className="inline-flex items-center gap-1"
                    data-testid="task-detail-tabs"
                  >
                    <Tabs.Trigger
                      value="transcript"
                      className="rounded px-2 py-1 text-[11px] font-medium text-[var(--color-muted,#6b7280)] data-[state=active]:bg-[var(--color-bg,#f5f0eb)] data-[state=active]:text-[var(--color-text,#171717)]"
                      data-testid="task-detail-tab-transcript"
                    >
                      Transcript
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="terminal"
                      className="rounded px-2 py-1 text-[11px] font-medium text-[var(--color-muted,#6b7280)] data-[state=active]:bg-[var(--color-bg,#f5f0eb)] data-[state=active]:text-[var(--color-text,#171717)]"
                      data-testid="task-detail-tab-terminal"
                    >
                      Terminal
                    </Tabs.Trigger>
                  </Tabs.List>
                  {centerTab === "transcript" ? (
                    <div className="flex items-center gap-3" data-testid="task-detail-transcript-header">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--color-info,#3B82F6)]"
                        />
                        <span data-testid="transcript-stat-events">
                          {transcriptStats.events} events
                        </span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--color-purple,#8B5CF6)]"
                        />
                        <span data-testid="transcript-stat-tool-uses">
                          {transcriptStats.toolUses} tool uses
                        </span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--color-warning,#D97706)]"
                        />
                        <span data-testid="transcript-stat-pending">
                          {transcriptStats.pending} pending
                        </span>
                      </span>
                    </div>
                  ) : null}
                </div>
                {/*
                 * forceMount on BOTH tabs — Radix's default unmounts inactive
                 * content, which would tear down xterm + the WS every toggle
                 * (external review F3). CSS hides inactive panes via
                 * data-state="inactive".
                 */}
                <Tabs.Content
                  value="transcript"
                  forceMount
                  className="min-h-0 flex-1 data-[state=inactive]:hidden"
                  data-testid="task-detail-transcript"
                >
                  <BubbleTranscript content={transcript.content} task={task} />
                </Tabs.Content>
                <Tabs.Content
                  value="terminal"
                  forceMount
                  className="relative min-h-0 flex-1 data-[state=inactive]:hidden"
                  data-testid="task-detail-terminal"
                >
                  <Suspense
                    fallback={
                      <div className="p-4 text-xs text-[var(--color-muted,#6b7280)]">
                        Loading terminal…
                      </div>
                    }
                  >
                    {taskId ? (
                      <EmbeddedTerminal
                        ref={terminalRef}
                        taskId={taskId}
                        active={centerTab === "terminal"}
                        onReadyChange={handleTerminalReady}
                        onGitignoreSuggestion={handleGitignoreSuggestion}
                        onPasteImageError={handlePasteImageError}
                      />
                    ) : null}
                  </Suspense>
                  {pasteImageError ? (
                    <div
                      className="absolute bottom-3 left-3 flex items-center gap-2 rounded border border-[var(--color-error,#DC2626)] bg-[var(--color-surface,#ffffff)] px-3 py-2 text-[12px] text-[var(--color-error,#DC2626)] shadow"
                      data-testid="paste-image-error-toast"
                      role="alert"
                    >
                      <span>Image paste failed: {pasteImageError}</span>
                      <button
                        type="button"
                        onClick={() => setPasteImageError(null)}
                        className="text-[11px] text-[var(--color-muted,#6b7280)]"
                        data-testid="paste-image-error-dismiss"
                        aria-label="Dismiss"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  {gitignoreToastOpen ? (
                    <div
                      className="absolute bottom-3 right-3 flex flex-col gap-1 rounded border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] px-3 py-2 text-[12px] shadow"
                      data-testid="gitignore-suggestion-toast"
                    >
                      <div className="flex items-center gap-2">
                        <span>
                          Add <code>.claude-pastes/</code> to <code>.gitignore</code>?
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleGitignoreAppend()}
                          disabled={gitignoreAppending}
                          className="rounded bg-[var(--color-primary,#171717)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                          data-testid="gitignore-suggestion-append"
                        >
                          {gitignoreAppending ? "Adding…" : "Append"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setGitignoreToastOpen(false)}
                          className="text-[11px] text-[var(--color-muted,#6b7280)]"
                          data-testid="gitignore-suggestion-dismiss"
                          aria-label="Dismiss"
                        >
                          ×
                        </button>
                      </div>
                      {gitignoreError ? (
                        <span
                          className="text-[11px] text-[var(--color-error,#DC2626)]"
                          data-testid="gitignore-suggestion-error"
                        >
                          Failed: {gitignoreError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {/* ADR-068-A1 AC-15: privacy disclosure (compact, dismissible).
                      Surfaces 24h retention + Windows ACL caveat; "Clear
                      history" affordance routes through TaskDetailHeader's
                      "..." menu (Phase 4 confirm modal). Client-side
                      dismissal persists in localStorage so power-users
                      can hide it after first read. */}
                  <PrivacyDisclosureFooter />
                </Tabs.Content>
              </Tabs.Root>
            </section>
          }
          right={
            <aside
              className="flex h-full min-h-0 flex-col border-l border-[var(--color-border,#e0dbd4)]"
              style={{ background: "var(--color-surface, #ffffff)" }}
              data-testid="task-detail-viewer"
            >
              <ViewerTabBar
                paths={selectedPaths}
                activePath={activePath}
                onActivate={setActivePath}
                onClose={handleCloseTab}
              />
              <div className="min-h-0 flex-1">
                <SmartViewer projectId={task.projectId} path={activePath} />
              </div>
            </aside>
          }
        />
      </div>
    </div>
  );
}
