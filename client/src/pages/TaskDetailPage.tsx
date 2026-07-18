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
import { useParams, useLocation, useNavigate } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";

import { useExternalTask } from "../hooks/useExternalTasks";
import { useTaskTranscript } from "../hooks/useTaskTranscript";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { BubbleTranscript } from "../components/external/BubbleTranscript";
import { TaskDetailHeader } from "../components/external/TaskDetailHeader";
import { TaskDetailThreePane } from "../components/external/TaskDetailThreePane";
import { FocusModeToggle } from "../components/external/FocusModeToggle";
import { FolderTree } from "../components/external/FolderTree";
import { SmartViewer } from "../components/external/SmartViewer";
import { ViewerTabBar } from "../components/external/SmartViewer/ViewerTabBar";
import { parseSessionJsonl, toolUses } from "../external/session-parser";
import {
  LaunchCoordinatorProvider,
  useLaunchCoordinator,
} from "../contexts/LaunchCoordinatorContext";
import { parseTerminalFocusIntent } from "../lib/taskDeepLink";
import { useTerminalFocusHotkey } from "../hooks/useTerminalFocusHotkey";

// Lazy-load the xterm bundle so the ~120 KB gz only ships when a TaskDetail
// actually opens (external review F6).
const EmbeddedTerminal = lazy(() =>
  import("../components/terminal/EmbeddedTerminal").then((m) => ({
    default: m.EmbeddedTerminal,
  })),
);

import type { EmbeddedTerminalHandle } from "../components/terminal/EmbeddedTerminal";
import { PrivacyDisclosureFooter } from "../components/external/TerminalPrivacyFooter";
import { MissionBody } from "../components/external/mission/MissionBody";
import {
  MissionTabRow,
  type MissionTab,
} from "../components/external/mission/MissionTabRow";

type CenterTab = "transcript" | "terminal";
const TAB_STORAGE_KEY = "webui:embedded-terminal-default-tab";
// Mission | Files & Terminal top switch. Default "files" keeps the terminal the
// mount-default view so the CI smoke gate + auto-launch + the ~50 terminal/replay
// specs stay byte-stable. A13 restyled this into MissionTabRow but DELIBERATELY
// did NOT flip the default (migrating that whole corpus is out of A13's budget);
// Mission is opt-in via the tab.
const MISSION_TAB_STORAGE_KEY = "webui:task-detail-mission-tab";

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

function TaskDetailPageBody() {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
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
  // Top-level Mission | Files & Terminal switch (A13 MissionTabRow). Default
  // "files" keeps the terminal the mount-default view (CI smoke gate + auto-launch
  // stay byte-stable); the Mission tab hosts the three-card shell.
  const [missionTab, setMissionTab] = useLocalStorage<MissionTab>(
    MISSION_TAB_STORAGE_KEY,
    "files",
  );
  const terminalRef = useRef<EmbeddedTerminalHandle | null>(null);

  // Iterate v0.8.2 AC-7/8/9 — terminal ready-envelope metadata surfaced
  // by EmbeddedTerminal via onTerminalMeta. Drives the conditional
  // disclosure footer (AC-8) + retention copy interpolation (AC-9).
  const [terminalMeta, setTerminalMeta] = useState<{
    replayOnly: boolean | null;
    scrollbackBytes: number | null;
    retentionDays: number | null;
    scrollbackDir: string | null;
  }>({
    replayOnly: null,
    scrollbackBytes: null,
    retentionDays: null,
    scrollbackDir: null,
  });

  // ADR-068-A1: when a pendingLaunch is dispatched (by TaskDetailHeader's
  // CTA), flip to the Terminal tab + mark a focus pending. The
  // EmbeddedTerminal then consumes pendingLaunch via context, awaits
  // the prompt-readiness handshake, and writes commands[shellKind]+"\r"
  // over the WS — replacing the old `webui:launch-copied` window-event
  // round-trip.
  const [pendingFocus, setPendingFocus] = useState(false);
  useEffect(() => {
    if (!coord.pendingLaunch) return;
    // A launch auto-executes in the embedded terminal — surface the Files &
    // Terminal tab so the pty is visible (a no-op unless the user is on Mission).
    setMissionTab("files");
    setCenterTab("terminal");
    setPendingFocus(true);
  }, [coord.pendingLaunch, setCenterTab, setMissionTab]);

  // iterate-2026-05-18-inbox-terminal-prompts — Inbox-origin navigation
  // carries `{ focusTerminal: true }` in React-Router nav state (set by
  // the InboxPage cards). On arrival, force the Terminal tab + mark a
  // pending focus so `handleTerminalReady` focuses xterm once the WS
  // reports ready — the same path the auto-launch CTA uses, and it
  // composes cleanly with `pendingLaunch` (both just set `pendingFocus`).
  // Ref-guarded against re-renders; the nav state is then cleared
  // (replace:true) so an F5 reload / back-forward to this same history
  // entry does not re-snap focus (external review gemini-1 + openai-1).
  const inboxFocusConsumedRef = useRef(false);
  useEffect(() => {
    if (inboxFocusConsumedRef.current) return;
    const navState = location.state as { focusTerminal?: boolean } | null;
    if (navState?.focusTerminal !== true) return;
    inboxFocusConsumedRef.current = true;
    setMissionTab("files");
    setCenterTab("terminal");
    setPendingFocus(true);
    navigate(`${location.pathname}${location.search}`, { replace: true });
  }, [
    location.pathname,
    location.search,
    location.state,
    navigate,
    setCenterTab,
    setMissionTab,
  ]);

  // A19 (FR-01.63) — the Inbox terminal-fallback CTA navigates here via a deep
  // link (`?pane=terminal&focus=terminal`, built in lib/taskDeepLink.ts). It is
  // the same intent as the card-click nav-state above, but as a real URL so it
  // survives a reload / is shareable. Consume it through the SAME pendingFocus
  // path (no second attach path), then strip the query (replace:true) so an F5 /
  // back-forward does not re-snap focus. Ref-guarded against re-renders.
  const deepLinkFocusConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkFocusConsumedRef.current) return;
    if (!parseTerminalFocusIntent(location.search)) return;
    deepLinkFocusConsumedRef.current = true;
    setMissionTab("files");
    setCenterTab("terminal");
    setPendingFocus(true);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate, setCenterTab, setMissionTab]);

  // Iterate v0.8.5 AC-6: the `webui:focus-terminal-tab` event listener
  // was removed alongside the Terminal-CTA in TaskDetailHeader (the
  // only dispatcher). The inline `Terminal` Tabs.Trigger inside the
  // page now owns the tab-flip directly via Radix Tabs state.

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

  // A21 (FR-01.65): `t` focuses the terminal + enters focus mode; Esc leaves.
  // Fence-guarded — inert while the terminal itself has focus (bytes reach the
  // pty). Focus mode is the EXISTING A18 maximize toggle (no parallel hide path).
  const focusTerminal = useCallback(() => {
    setMissionTab("files");
    setCenterTab("terminal");
    terminalRef.current?.focus();
  }, [setMissionTab, setCenterTab]);
  useTerminalFocusHotkey({ focusTerminal });

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
      <TaskDetailHeader task={task} modelName={transcript.modelName} />

      {/* Mission | Files & Terminal segmented switch + the glass "Open Ship's Log"
          button (A13, MissionTabRow). Files & Terminal stays the mount-default so
          the terminal / auto-launch / CI smoke gate stay byte-stable. */}
      <MissionTabRow value={missionTab} onChange={setMissionTab} taskId={task?.taskId} />

      {/* Mission tab — the three equal-height glass cards (A13, MissionBody).
          Mount-only when selected (no persistent resource to preserve). */}
      {missionTab === "mission" ? (
        <MissionBody task={task} transcriptContent={transcript.content} onOpenDocument={() => setMissionTab("files")} />
      ) : null}

      {/* Files & Terminal — always mounted (hidden) so the terminal WS survives a
          tab flip. Inset to line up with the tab control + Mission body (2026-07-17). */}
      <div className={missionTab === "files" ? "min-h-0 flex-1 px-4 pt-3 pb-4 md:px-8 md:pt-4 md:pb-[22px]" : "hidden"}>
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
              className="ft-card ft-term flex h-full min-h-0 flex-col"
              data-testid="task-detail-center"
            >
              <Tabs.Root
                value={centerTab}
                onValueChange={(v) => setCenterTab(v as CenterTab)}
                className="flex h-full min-h-0 flex-col"
              >
                <div
                  className="ft-head text-[11px]"
                  data-testid="task-detail-center-header"
                >
                  {/* Segmented Transcript/Terminal tabs, greyed .ft-head band —
                      same style as Mission Control (A18 .mc-tabs.ft-seg). Radix
                      role="tab" is preserved: the terminal E2E corpus pins
                      getByRole("tab",{name:/terminal/i}) to exactly one match. */}
                  <Tabs.List
                    className="mc-tabs ft-seg"
                    data-testid="task-detail-tabs"
                  >
                    <Tabs.Trigger
                      value="transcript"
                      className="mc-tab"
                      data-testid="task-detail-tab-transcript"
                    >
                      Transcript
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="terminal"
                      className="mc-tab"
                      data-testid="task-detail-tab-terminal"
                    >
                      Terminal
                    </Tabs.Trigger>
                  </Tabs.List>
                  {centerTab === "transcript" ? (
                    <div className="ml-auto flex items-center gap-3 text-[var(--color-muted,#6b7280)]" data-testid="task-detail-transcript-header">
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
                  {/* Maximize terminal (A18): collapses both side cards via the
                      existing useThreePaneLayout collapse→resize path. */}
                  <FocusModeToggle />
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
                        active={missionTab === "files" && centerTab === "terminal"}
                        onReadyChange={handleTerminalReady}
                        onGitignoreSuggestion={handleGitignoreSuggestion}
                        onPasteImageError={handlePasteImageError}
                        onTerminalMeta={setTerminalMeta}
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
                  {/* ADR-068-A1 AC-15 + iterate v0.8.2 AC-8/AC-9: privacy
                      disclosure (compact, dismissible). Renders only when
                      the server reports scrollbackBytes > 0 for this task
                      (AC-8). Retention copy interpolates the actual TTL +
                      resolved scrollback dir from the ready envelope (AC-9).
                      "Clear history" affordance still routes through the
                      "..." menu. */}
                  <PrivacyDisclosureFooter
                    scrollbackBytes={terminalMeta.scrollbackBytes}
                    retentionDays={terminalMeta.retentionDays}
                    scrollbackDir={terminalMeta.scrollbackDir}
                  />
                </Tabs.Content>
              </Tabs.Root>
            </section>
          }
          right={
            <aside
              className="ft-card ft-view flex h-full min-h-0 flex-col"
              data-testid="task-detail-viewer"
            >
              {/* Smart-Preview head: file tabs in the greyed .ft-head band (A18);
                  honest "Preview" placeholder until a file is opened — never the
                  prototype's canned .ft-crumb / .ft-code demo strings (AC7). */}
              <div className="ft-head" data-testid="task-detail-viewer-head">
                {selectedPaths.length > 0 ? (
                  <div className="min-w-0 flex-1">
                    <ViewerTabBar
                      paths={selectedPaths}
                      activePath={activePath}
                      onActivate={setActivePath}
                      onClose={handleCloseTab}
                    />
                  </div>
                ) : (
                  <span className="ft-title">Preview</span>
                )}
              </div>
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
