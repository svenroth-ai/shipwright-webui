/*
 * MissionTopRow — the `.mc-top` top row of Mission Control (A13, FR-01.57).
 *
 * A RESTYLE of the header, not a rewrite: every behaviour of the former
 * TaskDetailHeader is preserved verbatim (TaskDetailHeader now delegates here).
 * Deltas: (1) the breadcrumb — "Board › <Project>" with BOTH segments clickable
 * (Board → `/`, project → the projects surface until A16); (2) an ADDITIVE
 * "Awaiting approval" design-gate pill (from `useMissionState`, kept alongside the
 * rich task-state badge — lossless). Everything else is unchanged: title + rename,
 * Instruments, the Resume CTA (hidden when done), the full `⋯` HeaderMenu.
 *
 * Guards: NO chat composer (DO-NOT #3); Resume auto-executes (DO-NOT #5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useProjects } from "../../../hooks/useProjects";
import { useDeleteExternalTask } from "../../../hooks/useExternalTasks";
import { hasLaunchedBefore } from "../../../lib/taskLifecycle";
import { useIsPhoneViewport } from "../../../hooks/useIsCompactViewport";
import { useMissionState } from "../../../hooks/useMissionState";
import { type EditableTaskTitleHandle } from "../EditableTaskTitle";
import { ProjectChipMenu } from "../ProjectChipMenu";
import { ConfirmDeleteDialog } from "../ConfirmDeleteDialog";
import { SessionMetadata } from "../SessionMetadata";
import { EditTaskModal } from "../EditTaskModal";
import { TaskDescriptionDisclosure } from "../TaskDescriptionDisclosure";
import { StateBadge, STATE_BADGE_KEYFRAMES } from "../TaskDetailHeader/StateBadge";
import { LaunchCTA } from "../TaskDetailHeader/LaunchCTA";
import { ResumeCTA } from "../TaskDetailHeader/ResumeCTA";
import { TitleEdit } from "../TaskDetailHeader/TitleEdit";
import { HeaderMenu } from "../TaskDetailHeader/HeaderMenu";
import { Instruments } from "./Instruments";
import { MissionMetaLine } from "./MissionMetaLine";

type CtaMode = "launch" | "resume" | "none";

// FR-01.01 AC-6: a draft task that's already run must Resume, not Launch —
// `claude --session-id` against an already-used session is rejected.
function ctaFor(task: Pick<ExternalTask, "state" | "firstJsonlObservedAt">): CtaMode {
  if (task.state === "draft") return hasLaunchedBefore(task) ? "resume" : "launch";
  if (task.state === "idle" || task.state === "active") return "resume";
  return "none";
}

interface Props {
  task: ExternalTask;
  /** Model label from TaskDetailPage's single transcript poller (campaign D15). */
  modelName?: string | null;
}

export function MissionTopRow({ task, modelName }: Props) {
  const projectsQ = useProjects();
  const deleteMut = useDeleteExternalTask();
  const navigate = useNavigate();
  // Phone (≤767px): the breadcrumb + meta sub-line drop for terminal headroom.
  const isPhone = useIsPhoneViewport();
  // The cluster's shared mission-state derivation (A11) — drives the additive
  // design-gate pill; never re-derived (DO-NOT #16, no JSONL-mtime staleness).
  const missionState = useMissionState(task);

  const [ctaError, setCtaError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const titleRef = useRef<EditableTaskTitleHandle | null>(null);

  const cta = ctaFor(task);

  // Clear stale ctaError on CTA-mode flip (guarded so initial mount is a no-op).
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

  const startedAt = task.launchedAt ?? task.firstJsonlObservedAt ?? task.createdAt;
  const lastEventAt = task.lastJsonlSeenMtimeMs
    ? new Date(task.lastJsonlSeenMtimeMs).toISOString()
    : undefined;

  const handleRename = useCallback(() => titleRef.current?.startEdit(), []);

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
      // A05: `.mc-top` = anthracite ground + the scoped light --color-* flip so the
      // breadcrumb / title / meta read white on taupe. Asymmetric desktop padding
      // (17px 28px 17px 22px) lands the back-arrow glyph on the shared 32px gutter.
      className="mc-top relative flex w-full items-center gap-2 px-3 py-2 md:gap-4 md:py-[17px] md:pl-[22px] md:pr-[28px]"
      data-testid="task-detail-header"
    >
      <style>{STATE_BADGE_KEYFRAMES}</style>
      <Link to="/" className="text-[var(--color-muted,#6b7280)] transition hover:text-[var(--color-text,#1a1a1a)]" aria-label="Back to board" data-testid="task-detail-back">
        <ArrowLeft size={16} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {!isPhone && (
          <nav className="mc-crumb inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted,#6b7280)]" aria-label="Breadcrumb" data-testid="task-detail-breadcrumb">
            <Link to="/" className="crumb-link transition hover:text-[var(--color-text,#1a1a1a)]" data-testid="task-detail-crumb-board">Board</Link>
            <ChevronRight size={10} aria-hidden="true" className="opacity-50" />
            <Link to="/projects" className="crumb-link truncate transition hover:text-[var(--color-text,#1a1a1a)]" data-testid="task-detail-crumb-project">{projectName}</Link>
          </nav>
        )}

        <div className="relative flex flex-wrap items-center gap-2.5" data-testid="task-detail-title-row">
          <TitleEdit ref={titleRef} task={task} />
          <StateBadge state={task.state} />
          {missionState === "designgate" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-tint px-2.5 py-0.5 text-[11px] font-semibold text-warn" data-testid="mission-awaiting-approval">
              <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--warn-solid)]" style={{ animation: "taskDetailPulseDot 1.5s infinite" }} />
              Awaiting approval
            </span>
          )}
          <ProjectChipMenu task={task} open={projectPickerOpen} onOpenChange={setProjectPickerOpen} />
        </div>

        {!isPhone && (
          <MissionMetaLine task={task} startedAt={startedAt} lastEventAt={lastEventAt} modelName={modelName} />
        )}

        <TaskDescriptionDisclosure task={task} />
      </div>

      <div className="flex items-center gap-2" data-testid="task-detail-actions">
        {/* Mission instruments (A11): Grade · Tests · Serves. Hidden on phones. */}
        <Instruments task={task} />
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
