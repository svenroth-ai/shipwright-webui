/*
 * TaskDetailHeader — single header bar above the 3-pane body (iterate 3
 * section 04, FR-03.30; visual rebuild in iterate 3.7b-3 / Phase B3).
 *
 * Owns:
 *   - breadcrumb `Projects › <project.name>` above the title row
 *   - title + state badge (pulsing dot, color-coded to state) + project chip
 *   - sub-line: phase tag · Started {ago} · last event {ago} · {model}
 *   - state-dependent primary CTA (iterate 3.7e-b2, R3 button variants;
 *     Iterate L resume-cta-active-state replaced the ADR-095/096
 *     `liveSession` gating with `altScreenActive` after empirical
 *     falsification — `liveSession` was "pty alive", not "Claude in
 *     foreground"):
 *       draft / awaiting_external_start            → GREEN Launch
 *                                                    (var(--color-success))
 *       (active | idle) + altScreenActive=true     → no CTA (TUI live)
 *       (active | idle) + altScreenActive=false/   → BROWN Resume
 *                         undefined                  (var(--color-primary))
 *       done / launch_failed / jsonl_missing       → no CTA
 *     Terminal icon is always left of the label on both buttons.
 *   - 3-dots menu: Rename · Copy session UUID · Close · Delete · debug toggle
 *
 * Regression guards:
 *   - NO chat composer anywhere (CLAUDE.md DO-NOT #3).
 *   - "Resume" COPIES TO CLIPBOARD — never spawns Claude
 *     (DO-NOT #5).
 *   - Fork has moved to iterate 4 — menu must NOT surface it.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Folder,
  MoreVertical,
  Pencil,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import type {
  ExternalTask,
  ExternalTaskState,
} from "../../lib/externalApi";
import {
  useCloseExternalTask,
  useDeleteExternalTask,
} from "../../hooks/useExternalTasks";
import { useLaunchTask } from "../../hooks/useLaunchTask";
import { useProjects } from "../../hooks/useProjects";
import { useTaskTranscript } from "../../hooks/useTaskTranscript";
import { formatRelativeTime } from "../../lib/formatTime";
import { getPhaseStyle, derivePhaseFromTitle } from "../../lib/phaseStyle";
import { useLaunchCoordinator } from "../../contexts/LaunchCoordinatorContext";
import {
  EditableTaskTitle,
  type EditableTaskTitleHandle,
} from "./EditableTaskTitle";
import { ProjectChipMenu } from "./ProjectChipMenu";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { SessionMetadata } from "./SessionMetadata";

/**
 * State-badge visual definition. Background + foreground use HSL-flavoured
 * tones that match the mockup chip palette; the `dot` is the pulsing
 * circle rendered as a ::before equivalent (inline <span> with a
 * Tailwind `animate-pulse`).
 */
const STATE_BADGE: Record<
  ExternalTaskState,
  { bg: string; fg: string; dot: string; label: string; pulse: boolean }
> = {
  draft: {
    bg: "bg-[var(--color-muted-bg,#ede8e1)]",
    fg: "text-[var(--color-muted,#6b7280)]",
    dot: "bg-[var(--color-muted,#6b7280)]",
    label: "Draft",
    pulse: false,
  },
  awaiting_external_start: {
    bg: "bg-[#FEF3C7]",
    fg: "text-[#92400E]",
    dot: "bg-[#D97706]",
    label: "Awaiting launch",
    pulse: true,
  },
  active: {
    bg: "bg-[#FEF3C7]",
    fg: "text-[#92400E]",
    dot: "bg-[#D97706]",
    label: "In progress",
    pulse: true,
  },
  idle: {
    bg: "bg-[var(--color-muted-bg,#ede8e1)]",
    fg: "text-[var(--color-muted,#6b7280)]",
    dot: "bg-[var(--color-muted,#6b7280)]",
    label: "Idle",
    pulse: false,
  },
  jsonl_missing: {
    bg: "bg-[#FEE2E2]",
    fg: "text-[#991B1B]",
    dot: "bg-[var(--color-error,#DC2626)]",
    label: "JSONL missing",
    pulse: false,
  },
  launch_failed: {
    bg: "bg-[#FEE2E2]",
    fg: "text-[#991B1B]",
    dot: "bg-[var(--color-error,#DC2626)]",
    label: "Launch failed",
    pulse: false,
  },
  done: {
    bg: "bg-[#D1FAE5]",
    fg: "text-[#065F46]",
    dot: "bg-[var(--color-success,#059669)]",
    label: "Done",
    pulse: false,
  },
};

type CtaMode = "launch" | "resume" | "none";

function ctaFor(
  state: ExternalTask["state"],
  altScreenActive: boolean | undefined,
): CtaMode {
  if (state === "draft") return "launch";
  // Iterate v0.8.5 AC-6: drop the "Terminal" CTA for active /
  // awaiting_external_start. The button only flipped the inline
  // Tabs.Trigger row (pure UI nav, no auto-execute) — duplicating the
  // tab-row that already lives inside the page. Header now shows
  // status badge only for these states; user clicks the inline
  // `Terminal` Tabs.Trigger to switch panes.
  //
  // Iterate L (resume-cta-active-state):
  //   - The earlier ADR-095 / ADR-096 `liveSession` gating was
  //     falsified empirically — `liveSession` is "pty exists in
  //     PtyManager", not "Claude is in pty foreground". The pty
  //     hosts a shell (pwsh) which outlives Claude.
  //   - Replacement signal: `altScreenActive` (server-computed from
  //     the @xterm/headless mirror's `buffer.active.type ===
  //     "alternate"`). True iff a TUI (Claude, vim, htop, …) is in
  //     pty foreground. False otherwise — including "shell prompt
  //     visible after Claude exited", which is the recovery state
  //     where Resume MUST be available.
  //
  // Matrix:
  //   (idle | active) + altScreenActive=true       → no CTA (TUI live)
  //   (idle | active) + altScreenActive=false/undef → Resume
  //
  // `altScreenActive === undefined` (pre-iterate-L server, mirror
  // disabled by headless-probe, etc.) falls back to surfacing Resume —
  // conservative: prefer the recovery action to silent withholding.
  //
  // Single "Resume" label everywhere (no Recover differentiation, see
  // memory feedback_resume_label_singular). Architectural protection
  // against nested-Claude lives in pty-manager's shell-only spawn
  // whitelist + ADR-068-A1's user-initiated clause (an explicit
  // Resume click satisfies user-initiated).
  if (state === "idle" || state === "active") {
    if (altScreenActive === true) return "none";
    return "resume";
  }
  return "none";
}

function isTerminalState(state: ExternalTask["state"]): boolean {
  return state === "done";
}

// pickPlatformCommand was removed in iterate-2026-05-04 (ADR-068-A1):
// the auto-launch flow now picks the shell-form via the WS ready
// envelope's `shellKind` (server-authoritative), not navigator.userAgent.
// The CopyCommandForms type still flows through `coord.pendingLaunch`
// where EmbeddedTerminal indexes by shellKind directly.

async function writeClipboard(text: string): Promise<void> {
  // Try the modern Clipboard API first. ADR-067 regression note: when
  // the launch CTA fires from inside the embedded-terminal pane, focus
  // can briefly leave the document during React's pending-state
  // re-render of the button → `clipboard.writeText` rejects with
  // NotAllowedError. We catch and fall through to the textarea +
  // execCommand path so the user always gets the command in their
  // clipboard.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.warn("clipboard.writeText failed, falling back to textarea:", err);
      // fall through
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand('copy') returned false");
  } finally {
    document.body.removeChild(ta);
  }
}

interface Props {
  task: ExternalTask;
}

export function TaskDetailHeader({ task }: Props) {
  const launchMut = useLaunchTask();
  const closeMut = useCloseExternalTask();
  const navigate = useNavigate();
  const deleteMut = useDeleteExternalTask();
  const projectsQ = useProjects();
  const transcript = useTaskTranscript(task.taskId);
  const coord = useLaunchCoordinator();

  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [uuidCopied, setUuidCopied] = useState(false);
  // 3.7d-b2 — controls the ProjectChipMenu popover rendered off the
  // "Move to project…" menu item. Opens the popover on the chip's legacy
  // position (near the title) but without rendering the chip itself.
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uuidResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<EditableTaskTitleHandle | null>(null);

  const cta = ctaFor(task.state, task.altScreenActive);
  const badge = STATE_BADGE[task.state];

  const projectName = useMemo(() => {
    const list = projectsQ.data ?? [];
    const found = list.find((p) => p.id === task.projectId);
    if (found) return found.name;
    if (task.projectId === "unassigned") return "Unassigned";
    return task.projectId;
  }, [projectsQ.data, task.projectId]);

  /**
   * Phase source priority (2026-04-23):
   *   1. `task.phaseLabel` (server-persisted via /launch when NewIssueModal
   *      passed the full action context). This is the authoritative user
   *      choice — preferred so a compliance task titled "audit drift"
   *      shows a Compliance badge, not whatever the title regex guesses.
   *   2. Fallback — best-effort regex on title (legacy tasks launched
   *      before the wiring, or externally-created tasks without a
   *      pre-captured phase).
   *
   * Styling map is keyed by phase id (lowercase) so the server-sent
   * `task.phase` + `task.phaseLabel` pair can look up its colors; the
   * `label` in the rendered chip always uses `phaseLabel` verbatim.
   */
  // 2026-04-23 — iterate-20260423-chat-livetest-2 AC-B. Extracted the color
  // map into `lib/phaseStyle.ts` so TaskCard reuses the same palette —
  // keeps the kanban dot + chip styling consistent with the header badge.
  const phase = useMemo(() => {
    // Plain Claude (new-plain) has no phase by design — the title is a
    // free-form chat title, so neither persisted-phase nor keyword-
    // fallback should render a phase pill on the header.
    if (task.actionId === "new-plain") return null;
    if (task.phaseLabel && task.phase) {
      const style = getPhaseStyle(task.phase);
      return { label: task.phaseLabel, cls: style.cls, dot: style.dot };
    }
    // v0.3.1 — title-fallback extracted to phaseStyle.ts so TaskCard
    // shares the exact same heuristic. Keep the fallback in sync across
    // both surfaces with one helper.
    const guess = derivePhaseFromTitle(task.title);
    if (!guess) return null;
    const style = getPhaseStyle(guess.id);
    return { label: guess.label, cls: style.cls, dot: style.dot };
  }, [task.actionId, task.phase, task.phaseLabel, task.title]);

  // Compute "last event" from transcript ticks (polling). When transcript is
  // still loading we fall back to launchedAt / createdAt.
  const startedAt = task.launchedAt ?? task.firstJsonlObservedAt ?? task.createdAt;
  const lastEventAt = task.lastJsonlSeenMtimeMs
    ? new Date(task.lastJsonlSeenMtimeMs).toISOString()
    : undefined;

  // Best-effort model name — the parser strips the raw JSONL, so we scan
  // the transcript text directly for the most recent `"model":"..."`
  // occurrence (assistant events emit it at the message level). Harmless
  // fallback to null when the transcript hasn't loaded yet.
  const modelName = useMemo<string | null>(() => {
    if (!transcript.content) return null;
    const re = /"model"\s*:\s*"([^"]+)"/g;
    let last: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(transcript.content)) !== null) {
      last = m[1];
    }
    return last;
  }, [transcript.content]);

  const flashCopied = useCallback((label: string) => {
    setCopiedLabel(label);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedLabel(null), 1800);
  }, []);

  // ADR-068-A1: dispatch into the LaunchCoordinator (replaces the previous
  // `webui:launch-copied` window event + clipboard.writeText flow). The
  // EmbeddedTerminal consumes pendingLaunch via context and writes
  // `commands[shellKind] + "\r"` over the WS once the prompt-readiness
  // handshake clears. CTA disabled while pendingLaunch !== null OR
  // launchMut.isPending so rapid-clicks queue depth stays = 1.
  // Phase-3 review fix (HIGH): /spawn prewarm is best-effort but its
  // status IS checked. Network failure is tolerated (ws-upgrade will
  // ensure-or-create on first attach), but a 4xx/5xx response is
  // surfaced so the user knows the prewarm rejected (e.g.
  // task_cwd_unresolvable, pty_spawn_rejected). On 4xx/5xx we still
  // dispatch the auto-launch — the WS upgrade path is authoritative —
  // but we surface a non-blocking error message.
  const prewarmPty = useCallback(async (taskId: string): Promise<string | null> => {
    try {
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(taskId)}/spawn`,
        { method: "POST" },
      );
      if (res.ok) return null;
      const detail = await res.text().catch(() => "");
      return `prewarm ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`;
    } catch (err) {
      // Network errors are non-fatal — ws-upgrade will spawn.
      return err instanceof Error
        ? `prewarm network error: ${err.message}`
        : "prewarm network error";
    }
  }, []);

  // Live-smoke fix (2026-05-05): prewarm fires fire-and-forget AFTER
  // dispatch, NOT before. Reason — the original `await prewarmPty()` BEFORE
  // dispatchAutoLaunch could hang silently (Vite ws proxy ECONNABORTED was
  // observed once during a fresh connect cycle), blocking the dispatch
  // entirely. The WS-upgrade itself is the AUTHORITATIVE pty creation
  // path (ADR-067 + ADR-068-A1) — /spawn is only a latency optimization.
  // Decoupling them means: even if prewarm hangs, dispatch fires
  // immediately, EmbeddedTerminal connects + spawns pty via /ws, and
  // auto-execute proceeds.
  const handleLaunch = useCallback(async () => {
    setCtaError(null);
    if (launchMut.isPending || coord.pendingLaunch) return;
    try {
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: false,
      });
      coord.dispatchAutoLaunch(commands, false);
      flashCopied("Launching…");
      // Fire-and-forget prewarm — surfaces a warning if it 4xx/5xxs but
      // does not block dispatch.
      void prewarmPty(task.taskId).then((issue) => {
        if (issue) setCtaError(issue);
      });
    } catch (err) {
      setCtaError(err instanceof Error ? err.message : String(err));
    }
  }, [launchMut, task.taskId, flashCopied, coord, prewarmPty]);

  const handleResume = useCallback(async () => {
    setCtaError(null);
    if (launchMut.isPending || coord.pendingLaunch) return;
    try {
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: true,
      });
      coord.dispatchAutoLaunch(commands, true);
      flashCopied("Resuming…");
      void prewarmPty(task.taskId).then((issue) => {
        if (issue) setCtaError(issue);
      });
    } catch (err) {
      setCtaError(err instanceof Error ? err.message : String(err));
    }
  }, [launchMut, task.taskId, flashCopied, coord, prewarmPty]);

  const handleClose = useCallback(() => {
    // Iterate-2026-05-04 (ADR-068-A1, post-Phase-5-review): "Close task"
    // is a registry-state action ONLY — flips state to "done". The
    // embedded-terminal pty lifecycle is owned by separate actions
    // ("Stop terminal session" menu item below + nav-away which fires
    // last-conn-close → pty.kill). Piggybacking pty teardown on a
    // registry-state action was flagged as a UX behavior change beyond
    // spec; reverted.
    closeMut.mutate(task.taskId);
  }, [closeMut, task.taskId]);

  // ADR-068-A1: explicit "Stop terminal session" action — kills the
  // embedded-terminal pty without touching the registry state. Best-
  // effort; failures are logged via console.warn (the user is unlikely
  // to care if a stop fails — the pty will idle out at 30 min anyway).
  const handleStopTerminal = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(task.taskId)}/close`,
        { method: "POST" },
      );
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[task-detail] stop-terminal returned HTTP ${res.status}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[task-detail] stop-terminal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [task.taskId]);

  // Iterate-2026-05-04 (ADR-068-A1): "Clear terminal history" — destructive
  // cleanup of disk-backed scrollback. Surfaced via "..." overflow menu;
  // confirm-modal in the page layer guards accidental clicks.
  const [confirmClearHistoryOpen, setConfirmClearHistoryOpen] = useState(false);
  const [clearHistoryError, setClearHistoryError] = useState<string | null>(null);
  const handleConfirmClearHistory = useCallback(async () => {
    setClearHistoryError(null);
    try {
      const res = await fetch(
        `/api/terminal/${encodeURIComponent(task.taskId)}/clear-scrollback`,
        { method: "POST" },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        setClearHistoryError(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
        return;
      }
      setConfirmClearHistoryOpen(false);
    } catch (err) {
      setClearHistoryError(err instanceof Error ? err.message : String(err));
    }
  }, [task.taskId]);

  const handleDelete = useCallback(() => {
    if (
      isTerminalState(task.state) ||
      task.state === "draft" ||
      task.state === "launch_failed" ||
      task.state === "jsonl_missing"
    ) {
      deleteMut.mutate(task.taskId, {
        onSuccess: () => navigate("/"),
      });
      return;
    }
    setConfirmDeleteOpen(true);
  }, [deleteMut, navigate, task.state, task.taskId]);

  const handleRename = useCallback(() => {
    titleRef.current?.startEdit();
  }, []);

  const handleCopyUuid = useCallback(async () => {
    try {
      await writeClipboard(task.sessionUuid);
      setUuidCopied(true);
      if (uuidResetTimer.current) clearTimeout(uuidResetTimer.current);
      uuidResetTimer.current = setTimeout(() => setUuidCopied(false), 1500);
    } catch {
      /* clipboard denied — no fatal path */
    }
  }, [task.sessionUuid]);

  return (
    <header
      className="relative flex w-full items-center gap-4 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] px-6 py-3"
      data-testid="task-detail-header"
    >
      {/* Inline keyframes so we do not have to touch index.css. */}
      <style>{`@keyframes taskDetailPulseDot { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
      <Link
        to="/"
        className="text-[var(--color-muted,#6b7280)] transition hover:text-[var(--color-text,#1a1a1a)]"
        aria-label="Back to board"
        data-testid="task-detail-back"
      >
        <ArrowLeft size={16} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <nav
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted,#6b7280)]"
          aria-label="Breadcrumb"
          data-testid="task-detail-breadcrumb"
        >
          <Link
            to="/projects"
            className="transition hover:text-[var(--color-text,#1a1a1a)]"
          >
            Projects
          </Link>
          <ChevronRight
            size={10}
            aria-hidden="true"
            className="opacity-50"
          />
          <span className="truncate">{projectName}</span>
        </nav>

        {/*
         * 3.7d-b2 — title + state badge must share a single flex row with
         * items-center (prior baseline alignment looked off because the
         * badge has extra padding). ProjectChipMenu is no longer rendered
         * here; the breadcrumb above already shows the project. Project
         * change happens via the "Move to project…" 3-dots menu item that
         * opens the controlled popover anchored below.
         */}
        <div
          className="relative flex flex-wrap items-center gap-2.5"
          data-testid="task-detail-title-row"
        >
          <EditableTaskTitle ref={titleRef} task={task} />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.fg}`}
            data-testid="task-state-badge"
          >
            <span
              className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${badge.dot}`}
              data-testid="task-detail-state-dot"
              data-state={task.state}
              style={
                badge.pulse
                  ? {
                      animation: "taskDetailPulseDot 1.5s infinite",
                    }
                  : undefined
              }
            />
            {badge.label}
          </span>
          {/* Headless ProjectChipMenu: renders no visible chip, only the
           * popover when `projectPickerOpen` flips true. Popover anchors
           * relative to this title row. */}
          <ProjectChipMenu
            task={task}
            open={projectPickerOpen}
            onOpenChange={setProjectPickerOpen}
          />
        </div>

        <div
          className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-[var(--color-muted,#6b7280)]"
          data-testid="task-detail-subline"
        >
          {phase && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-[10px] px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.04em] ${phase.cls}`}
            >
              <span
                className={`inline-block h-[5px] w-[5px] rounded-full ${phase.dot}`}
              />
              {phase.label}
            </span>
          )}
          {phase && (
            <span
              aria-hidden="true"
              className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]"
            />
          )}
          <span>
            Started {formatRelativeTime(startedAt)}
            {lastEventAt
              ? ` · last event ${formatRelativeTime(lastEventAt)}`
              : ""}
          </span>
          {modelName && (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]"
              />
              <span className="font-mono text-[11px]">{modelName}</span>
            </>
          )}
        </div>
      </div>

      <div
        className="flex items-center gap-2"
        data-testid="task-detail-actions"
      >
        {/*
         * Iterate 3.7e-b2 — Header primary CTA state-mapping (R3):
         *   draft / awaiting_external_start → GREEN Launch (var(--color-success))
         *   active / idle                   → BROWN Resume (var(--color-primary))
         *   done / launch_failed / jsonl_missing → no button
         * Terminal icon is ALWAYS left of the label (Foundation R3 guarantee),
         * even in the transient "Copied" state — no Rocket/Copy swap anymore.
         * Testids `cta-launch-in-terminal` + `cta-copy-resume-command` stay
         * load-bearing (Playwright specs 30/36/36b/43/48/70-d/70-f + unit tests).
         */}
        {cta === "launch" && (
          <button
            type="button"
            onClick={() => void handleLaunch()}
            disabled={launchMut.isPending || coord.pendingLaunch !== null}
            className="inline-flex items-center gap-2 rounded-[var(--radius-button,8px)] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition disabled:opacity-60"
            style={{ background: "var(--color-success, #059669)" }}
            onMouseEnter={(ev) => {
              ev.currentTarget.style.background = "#047857";
            }}
            onMouseLeave={(ev) => {
              ev.currentTarget.style.background = "var(--color-success, #059669)";
            }}
            data-testid="cta-launch-in-terminal"
            data-color="green"
            aria-label="Launch — auto-execute in embedded terminal"
          >
            <TerminalIcon size={14} />
            {launchMut.isPending
              ? "Preparing…"
              : copiedLabel === "Launching…"
              ? "Sent — terminal opening"
              : "Launch"}
          </button>
        )}
        {cta === "resume" && (
          <button
            type="button"
            onClick={() => void handleResume()}
            disabled={launchMut.isPending || coord.pendingLaunch !== null}
            className="inline-flex items-center gap-2 rounded-[var(--radius-button,8px)] bg-[var(--color-resume,#C08862)] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[var(--color-resume-hover,#A67352)] disabled:opacity-60"
            data-testid="cta-copy-resume-command"
            data-color="orange"
            aria-label="Resume — auto-execute in embedded terminal"
          >
            <TerminalIcon size={14} />
            {launchMut.isPending
              ? "Preparing…"
              : copiedLabel === "Resuming…"
              ? "Sent — terminal opening"
              : "Resume"}
          </button>
        )}
        {/* Iterate v0.8.5 AC-6: removed the "Terminal" CTA — see
            ctaFor() above for the new matrix. The inline `Terminal`
            Tabs.Trigger inside the page covers the tab-flip. */}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] text-[var(--color-muted,#6b7280)] transition hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              data-testid="task-detail-menu-trigger"
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-[200px] rounded-lg border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] p-1 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
              data-testid="task-detail-menu"
            >
              <DropdownMenu.Item
                onSelect={() => handleRename()}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="task-detail-menu-rename"
              >
                <Pencil size={14} className="text-[var(--color-muted,#6b7280)]" />
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  // keep menu open briefly so the "Copied!" pip is visible
                  e.preventDefault();
                  void handleCopyUuid();
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="task-detail-menu-copy-uuid"
              >
                <Clipboard
                  size={14}
                  className="text-[var(--color-muted,#6b7280)]"
                />
                {uuidCopied ? "Copied!" : "Copy session UUID"}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  // Let the Radix DropdownMenu close naturally; wait for
                  // its focus-scope to release BEFORE opening the Popover.
                  // 80 ms empirically covers Radix's cleanup + the fresh
                  // tick in which we can safely focus the new portal.
                  window.setTimeout(() => setProjectPickerOpen(true), 80);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="task-detail-menu-move-project"
              >
                <Folder
                  size={14}
                  className="text-[var(--color-muted,#6b7280)]"
                />
                Move to project…
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border,#e0dbd4)]" />
              <DropdownMenu.Item
                disabled={isTerminalState(task.state)}
                onSelect={() => handleClose()}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
                data-testid="task-detail-menu-close"
              >
                <X size={14} className="text-[var(--color-muted,#6b7280)]" />
                Close task
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void handleStopTerminal()}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text,#1a1a1a)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="task-detail-menu-stop-terminal"
              >
                <X size={14} className="text-[var(--color-muted,#6b7280)]" />
                Stop terminal session
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => handleDelete()}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-error,#DC2626)] outline-none transition hover:bg-[var(--color-error,#DC2626)]/10"
                data-testid="task-detail-menu-delete"
              >
                <Trash2
                  size={14}
                  className="text-[var(--color-error,#DC2626)]"
                />
                Delete task
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => {
                  // Iterate v0.8.2 AC-1 (Spec 74 modal flake):
                  // Let the dropdown close cleanly (no preventDefault), then
                  // open the confirm modal on the next animation frame. Without
                  // this, the dropdown's still-active dismiss frame races
                  // Playwright's `toBeVisible` on the dialog under Windows
                  // ConPTY and times out at 30 s.
                  requestAnimationFrame(() => setConfirmClearHistoryOpen(true));
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-error,#DC2626)] outline-none transition hover:bg-[var(--color-error,#DC2626)]/10"
                data-testid="task-detail-menu-clear-history"
              >
                <Trash2
                  size={14}
                  className="text-[var(--color-error,#DC2626)]"
                />
                Clear terminal history
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border,#e0dbd4)]" />
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  setShowDebug((v) => !v);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--color-muted,#6b7280)] outline-none transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="task-detail-menu-toggle-debug"
              >
                <ChevronUp
                  size={14}
                  style={{ transform: showDebug ? "none" : "rotate(180deg)" }}
                />
                {showDebug ? "Hide session details" : "Show session details"}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {ctaError && (
        <span
          role="alert"
          className="absolute right-6 top-full mt-1 rounded bg-[var(--color-error,#DC2626)]/10 px-2 py-0.5 text-[11px]"
          style={{ color: "var(--color-error, #DC2626)" }}
          data-testid="task-detail-cta-error"
        >
          {ctaError}
        </span>
      )}

      {showDebug && (
        <div
          className="absolute left-0 right-0 top-full z-40 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-6 py-2"
          data-testid="task-detail-session-metadata"
        >
          <SessionMetadata task={task} />
        </div>
      )}

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        task={task}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          deleteMut.mutate(task.taskId, {
            onSuccess: () => navigate("/"),
          });
        }}
      />

      {/* ADR-068-A1: Clear-history confirm modal. Inline (vs reusing
          ConfirmDeleteDialog which is task-shaped) so the copy is
          terminal-specific + the destructive action is contained. */}
      {confirmClearHistoryOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          data-testid="confirm-clear-history-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmClearHistoryOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-card,12px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] p-5 shadow-[var(--shadow-card,0_6px_30px_rgba(0,0,0,0.10))]"
            data-testid="confirm-clear-history-dialog"
          >
            <h2 className="text-[15px] font-semibold text-[var(--color-text,#1a1a1a)]">
              Clear terminal history?
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-muted,#6b7280)]">
              The persisted terminal scrollback for this task will be deleted
              from disk. The active session (if any) keeps running. This
              cannot be undone.
            </p>
            {clearHistoryError ? (
              <p
                className="mt-3 text-[12px] text-[var(--color-error,#DC2626)]"
                data-testid="confirm-clear-history-error"
              >
                Failed: {clearHistoryError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearHistoryOpen(false)}
                className="rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] px-3 py-1.5 text-[12px] text-[var(--color-text,#1a1a1a)] transition hover:bg-[var(--color-muted-bg,#ede8e1)]"
                data-testid="confirm-clear-history-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmClearHistory()}
                className="rounded-[var(--radius-button,8px)] bg-[var(--color-error,#DC2626)] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
                data-testid="confirm-clear-history-confirm"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
