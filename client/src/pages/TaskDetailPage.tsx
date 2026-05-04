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

  // Phase-3 review fix (HIGH): explicit page-unmount cancel (Decision #17).
  // The provider unmount also clears state, but recording an explicit
  // `cancelLaunch("page-unmount")` reason is required by AC-5 so coord
  // diagnostics + lastCancelReason reflect the true source.
  useEffect(() => {
    return () => {
      // Capture coord at effect-mount time; if a pending exists at
      // unmount, fire the explicit cancel reason. Defense-in-depth —
      // safe to call even when no pending exists (no-op in that case).
      coord.cancelLaunch("page-unmount");
    };
    // Intentionally empty deps — the effect must fire ONLY at unmount.
    // coord identity is stable (memoized in the provider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drives the readiness handshake: when the terminal reports ready=true
  // and a focus is pending, focus xterm. Single retry on next ready
  // transition keeps it simple — no busy loop. Reader-role tabs cancel
  // any pending launch so it cannot fire later.
  const handleTerminalReady = useCallback(
    (ready: boolean, role: import("../hooks/useTerminalSocket").TerminalRole | null) => {
      if (ready && role === "reader" && coord.pendingLaunch) {
        coord.cancelLaunch("role-not-writer");
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
