/*
 * TaskDetailHeader — composition root for the header bar (FR-03.30).
 *
 * Split into stable-prop sub-components under `./TaskDetailHeader/`
 * (Campaign C / C6, 2026-05-26): StateBadge / LaunchCTA / ResumeCTA /
 * TitleEdit / HeaderMenu (+ ConfirmClearHistoryDialog + HeaderMenuItems
 * as HeaderMenu's internal helpers). The shell owns layout, breadcrumb,
 * phase chip, sub-line, `ctaError` (cleared on CTA-mode flip per OAI-3
 * / GEM-2), and the lift-state dialogs / popovers.
 *
 * Regression guards: NO chat composer (CLAUDE.md DO-NOT #3); Resume
 * auto-executes via LaunchCoordinator (DO-NOT #5); Fork out of scope.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

import type { ExternalTask } from "../../lib/externalApi";
import { useTaskTranscript } from "../../hooks/useTaskTranscript";
import { useProjects } from "../../hooks/useProjects";
import { useDeleteExternalTask } from "../../hooks/useExternalTasks";
import { formatRelativeTime } from "../../lib/formatTime";
import { getPhaseStyle, resolveTaskPhase } from "../../lib/phaseStyle";
import { hasLaunchedBefore } from "../../lib/taskLifecycle";
import { type EditableTaskTitleHandle } from "./EditableTaskTitle";
import { ProjectChipMenu } from "./ProjectChipMenu";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { SessionMetadata } from "./SessionMetadata";
import { EditTaskModal } from "./EditTaskModal";
import { TaskDescriptionDisclosure } from "./TaskDescriptionDisclosure";
import { StateBadge, STATE_BADGE_KEYFRAMES } from "./TaskDetailHeader/StateBadge";
import { LaunchCTA } from "./TaskDetailHeader/LaunchCTA";
import { ResumeCTA } from "./TaskDetailHeader/ResumeCTA";
import { TitleEdit } from "./TaskDetailHeader/TitleEdit";
import { HeaderMenu } from "./TaskDetailHeader/HeaderMenu";

type CtaMode = "launch" | "resume" | "none";

// FR-01.01 AC-6: a draft task that's already run (firstJsonlObservedAt
// set, e.g. moved back to Backlog) must Resume, not start a fresh Launch
// — `claude --session-id` against an already-used session is rejected.
function ctaFor(
  task: Pick<ExternalTask, "state" | "firstJsonlObservedAt">,
): CtaMode {
  if (task.state === "draft") return hasLaunchedBefore(task) ? "resume" : "launch";
  if (task.state === "idle" || task.state === "active") return "resume";
  return "none";
}

interface Props {
  task: ExternalTask;
}

export function TaskDetailHeader({ task }: Props) {
  const projectsQ = useProjects();
  const transcript = useTaskTranscript(task.taskId);
  const deleteMut = useDeleteExternalTask();
  const navigate = useNavigate();

  const [ctaError, setCtaError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const titleRef = useRef<EditableTaskTitleHandle | null>(null);

  const cta = ctaFor(task);

  // GEM-2 / OAI-3 — clear stale ctaError on CTA-mode flip. Guarded so
  // initial mount (ctaError already null) does not dispatch a setState.
  useEffect(() => {
    setCtaError((prev) => (prev === null ? prev : null));
  }, [task.state]);

  const projectName = useMemo(() => {
    const list = projectsQ.data ?? [];
    const found = list.find((p) => p.id === task.projectId);
    if (found) return found.name;
    if (task.projectId === "unassigned") return "Unassigned";
    return task.projectId;
  }, [projectsQ.data, task.projectId]);

  // Phase resolution shared with TaskCard via resolveTaskPhase — handles
  // new-plain (no badge), persisted phase, new-iterate (always "Iterate"),
  // and the legacy title-keyword fallback in one place.
  const phase = useMemo(() => {
    const resolved = resolveTaskPhase(task);
    if (!resolved) return null;
    const style = getPhaseStyle(resolved.id);
    return { label: resolved.label, cls: style.cls, dot: style.dot };
  }, [task]);

  const startedAt = task.launchedAt ?? task.firstJsonlObservedAt ?? task.createdAt;
  const lastEventAt = task.lastJsonlSeenMtimeMs
    ? new Date(task.lastJsonlSeenMtimeMs).toISOString()
    : undefined;

  // Best-effort model name from the most recent `"model":"..."` in transcript.
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

  const handleRename = useCallback(() => titleRef.current?.startEdit(), []);

  // HIGH-2 fix (C6 code review): single `deleteMut` instance in the shell.
  // Immediate-delete + redirect for terminal/draft/failed; confirm dialog
  // for In-Progress. Mirrors pre-split `handleDelete` semantics exactly.
  const handleDeleteClick = useCallback(() => {
    const immediate =
      task.state === "done" ||
      task.state === "draft" ||
      task.state === "launch_failed" ||
      task.state === "jsonl_missing";
    if (immediate) {
      deleteMut.mutate(task.taskId, { onSuccess: () => navigate("/") });
    } else {
      setConfirmDeleteOpen(true);
    }
  }, [deleteMut, navigate, task.state, task.taskId]);

  return (
    <header
      className="relative flex w-full items-center gap-4 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#ffffff)] px-6 py-3"
      data-testid="task-detail-header"
    >
      <style>{STATE_BADGE_KEYFRAMES}</style>
      <Link to="/" className="text-[var(--color-muted,#6b7280)] transition hover:text-[var(--color-text,#1a1a1a)]" aria-label="Back to board" data-testid="task-detail-back">
        <ArrowLeft size={16} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <nav className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted,#6b7280)]" aria-label="Breadcrumb" data-testid="task-detail-breadcrumb">
          <Link to="/projects" className="transition hover:text-[var(--color-text,#1a1a1a)]">Projects</Link>
          <ChevronRight size={10} aria-hidden="true" className="opacity-50" />
          <span className="truncate">{projectName}</span>
        </nav>

        <div className="relative flex flex-wrap items-center gap-2.5" data-testid="task-detail-title-row">
          <TitleEdit ref={titleRef} task={task} />
          <StateBadge state={task.state} />
          <ProjectChipMenu task={task} open={projectPickerOpen} onOpenChange={setProjectPickerOpen} />
        </div>

        <div
          className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-[var(--color-muted,#6b7280)]"
          data-testid="task-detail-subline"
        >
          {phase && (
            <>
              <span className={`inline-flex items-center gap-1.5 rounded-[10px] px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.04em] ${phase.cls}`}>
                <span className={`inline-block h-[5px] w-[5px] rounded-full ${phase.dot}`} />
                {phase.label}
              </span>
              <span aria-hidden="true" className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]" />
            </>
          )}
          <span>
            Started {formatRelativeTime(startedAt)}
            {lastEventAt ? ` · last event ${formatRelativeTime(lastEventAt)}` : ""}
          </span>
          {modelName && (
            <>
              <span aria-hidden="true" className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]" />
              <span className="font-mono text-[11px]">{modelName}</span>
            </>
          )}
        </div>

        <TaskDescriptionDisclosure task={task} />
      </div>

      <div className="flex items-center gap-2" data-testid="task-detail-actions">
        {cta === "launch" && <LaunchCTA task={task} onError={setCtaError} />}
        {cta === "resume" && <ResumeCTA task={task} onError={setCtaError} />}
        <HeaderMenu
          task={task}
          onOpenEditTask={() => setEditOpen(true)}
          onRename={handleRename}
          onOpenProjectPicker={() => setProjectPickerOpen(true)}
          onDeleteClick={handleDeleteClick}
          onToggleDebug={() => setShowDebug((v) => !v)}
          showDebug={showDebug}
        />
      </div>

      {ctaError && (
        <span role="alert" className="absolute right-6 top-full mt-1 rounded bg-[var(--color-error,#DC2626)]/10 px-2 py-0.5 text-[11px]" style={{ color: "var(--color-error, #DC2626)" }} data-testid="task-detail-cta-error">
          {ctaError}
        </span>
      )}

      {showDebug && (
        <div className="absolute left-0 right-0 top-full z-40 border-b border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-6 py-2" data-testid="task-detail-session-metadata">
          <SessionMetadata task={task} />
        </div>
      )}

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        task={task}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          deleteMut.mutate(task.taskId, { onSuccess: () => navigate("/") });
        }}
      />

      <EditTaskModal open={editOpen} onOpenChange={setEditOpen} task={task} />
    </header>
  );
}
