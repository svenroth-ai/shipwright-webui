/*
 * Task Board — kanban view with header dropdown + 3-column grid.
 *
 * Iterate 3 remediation Phase B1 (2026-04-20):
 *   - Header rebuild: h1/subtitle removed; <ProjectFilterDropdown> IS the
 *     title region per mockup `webui/designs/screens/kanban-with-projects.html`.
 *   - Right-side actions: PreviewButton + CreateMenuSplitButton (unchanged
 *     behavior; restyled per mockup).
 *   - 3 columns (Draft / In progress / Done) with per-column colored top
 *     border + tinted bg + uppercase 13px header + count pill. No state
 *     renames — visual change only.
 *   - Status + Phase chip rows: deferred to Phase C. See
 *     project-docs/ADRs/ADR-045-taskboard-status-phase-chips-deferred.md.
 *   - Global `i` shortcut retained.
 *
 * Iterate 3 remediation v2 — Surface 1 (2026-04-21):
 *   - Board/List view toggle in the header (default: board). View persists
 *     to localStorage ("webui.taskBoardView") + URL ?view=list.
 *   - Column board uses wider gaps (20px) + wider horizontal padding
 *     (28px) so the 3-column layout breathes at 1280px. Per-column top
 *     stripes unchanged (3px), draft stripe color tightened to a
 *     perceptible shade against the warm-beige page bg.
 *
 * Iterate 3.7d-b1 (2026-04-22):
 *   - Board centered inside a 1600px max-width container so ultra-wide
 *     monitors get symmetric whitespace instead of a left-anchored board.
 *     Board still fills the width up to 1600px — no regression on 1280px.
 *   - Column gutter bumped 20 → 32px so the 3-column layout breathes.
 *   - List view rebuilt as a proper <table> (moved into TaskList.tsx).
 *
 * Iterate 3.7e-b1 (2026-04-22):
 *   - Columns widened 320 → 360 px; gutter 32 → 40 px (plan S1.1).
 *   - New filter row above the columns inside .page-container — Status
 *     chips (multi-select; all selected = no filter). Phase filter is
 *     hidden entirely while ADR-045 is deferred (task.phase not populated).
 *
 * Preserved testids:
 *   task-board-page, task-board-header, task-board-columns,
 *   column-draft, column-in-progress, column-done,
 *   create-menu-*, preview-button, task-card-<id>.
 * New testids (iterate 3.7c-1):
 *   view-toggle-root, view-toggle-board, view-toggle-list,
 *   task-list-view, task-list-row-<id>.
 * Iterate 3.7d-b1: the kanban columns container also carries
 *   `data-page-container="true"` as a style hook (no new testid needed —
 *   the existing `task-board-columns` testid remains the board root).
 * Iterate 3.7e-b1:
 *   board-filter-status, board-filter-status-<value>.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import type {
  ActionDefinition,
  ExternalTask,
  ExternalTaskState,
} from "../lib/externalApi";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { useProjects } from "../hooks/useProjects";
import { useProjectFilter } from "../hooks/useProjectFilter";
import { useProjectActions } from "../hooks/useProjectActions";
import { useRunConfig } from "../hooks/useRunConfig";
import { TaskBoardColumns } from "../components/external/TaskBoardColumns";
import { TaskBoardEmptyState } from "../components/external/TaskBoardEmptyState";
import { TaskList } from "../components/external/TaskList";
import { ViewToggle, type TaskBoardView } from "../components/external/ViewToggle";
import { CreateControls } from "../components/external/CreateControls";
import { ProjectFilterDropdown } from "../components/external/ProjectFilterDropdown";
import { ComplianceGradeBadge } from "../components/compliance/ComplianceGradeBadge";
import {
  StatusPillRow,
  StatusFilterMenu,
} from "../components/external/BoardStatusFilter";
import { useMobileTopBarSlot } from "../components/external/MobileTopBarSlot";
import { PageHead } from "../components/common/PageHead";
import { useIsPhoneViewport } from "../hooks/useIsCompactViewport";
import { NewIssueModal } from "../components/external/NewIssueModal";
import { PipelineLaneCard } from "../components/external/PipelineLaneCard";
import { CampaignsLane } from "../components/external/CampaignsLane";
import { ContinuePipelineModal } from "../components/external/ContinuePipelineModal";
import { resolveRunMode } from "../lib/run-config-v2";
import { UNASSIGNED_PROJECT_ID } from "../lib/projectIds";

/** Synthetic action id used by the "Continue Pipeline" entry. Routed
 * separately from real catalog actions: clicking it opens
 * ContinuePipelineModal, not NewIssueModal. */
const CONTINUE_PIPELINE_ACTION_ID = "continue-pipeline";

const VIEW_STORAGE_KEY = "webui.taskBoardView";
const VIEW_URL_PARAM = "view";

function readStoredView(): TaskBoardView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

export default function TaskBoardPage() {
  const queryClient = useQueryClient();
  const { activeProjectId } = useProjectFilter();
  // Phone (≤767px): the project dropdown moves up into the global top bar and
  // the status filter collapses to an icon menu (iterate-2026-06-15 AC-1/AC-2).
  const isPhone = useIsPhoneViewport();
  const topBarSlot = useMobileTopBarSlot();
  // iterate 3.7h (2026-04-22): use the GLOBAL (projectId-less) cache entry —
  // ProjectFilterDropdown also uses this so both consumers share it. Filter
  // happens client-side below via `projectFiltered`. The per-filter query-key
  // approach tried in 3.7f caused a cache-drift visual glitch when toggling
  // "All projects" from a single project (columns briefly empty while the
  // new key fetched). Single cache entry = zero drift.
  const { data: tasks = [], isLoading } = useExternalTasks();
  const { data: projects = [] } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  // View state — URL wins on mount, falls back to localStorage.
  const [view, setViewState] = useState<TaskBoardView>(() => {
    const urlView = searchParams.get(VIEW_URL_PARAM);
    if (urlView === "list" || urlView === "board") return urlView;
    return readStoredView();
  });

  const setView = useCallback(
    (next: TaskBoardView) => {
      setViewState(next);
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "board") {
            p.delete(VIEW_URL_PARAM);
          } else {
            p.set(VIEW_URL_PARAM, next);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Resolve the actions schema for the active project. When "All projects"
  // is selected, fall back to the first real project so the dropdown still
  // shows something — the modal itself re-picks the project at launch time.
  const realProjects = useMemo(
    () => projects.filter((p) => !p.synthesized && p.id !== UNASSIGNED_PROJECT_ID),
    [projects],
  );
  const resolvedProjectId = useMemo<string | null>(() => {
    if (activeProjectId && activeProjectId !== UNASSIGNED_PROJECT_ID) {
      return activeProjectId;
    }
    return realProjects[0]?.id ?? null;
  }, [activeProjectId, realProjects]);

  const actionsQuery = useProjectActions(resolvedProjectId);
  const baseActionsList: ActionDefinition[] = actionsQuery.data?.actions ?? [];

  // iterate/multi-session-run-orchestrator-v2 — Pipelines lane.
  // Polls run-config for the active project; renders a MasterTaskCard
  // when a v2 config exists. Missing / v1 / invalid → no lane.
  const runConfigQuery = useRunConfig(resolvedProjectId);
  const activeProjectMeta = useMemo(
    () => projects.find((p) => p.id === resolvedProjectId) ?? null,
    [projects, resolvedProjectId],
  );

  // Continue Pipeline menu entry availability: only when v2 run-config is
  // healthy AND there's at least one ready-to-launch phase_task. Gated on
  // status === "in_progress" so a complete/failed run doesn't expose it.
  const continuePipelineAvailable =
    runConfigQuery.data?.status === "ok" &&
    runConfigQuery.data.config.status === "in_progress" &&
    runConfigQuery.data.readyToLaunchTasks.length > 0 &&
    // Single-session runs are driven by the /shipwright-run master (no per-phase
    // Continue) — the menu entry is a multi-session-only affordance (W3).
    resolveRunMode(runConfigQuery.data.config) !== "single_session";

  const actionsList: ActionDefinition[] = useMemo(() => {
    if (!continuePipelineAvailable) return baseActionsList;
    const synthetic: ActionDefinition = {
      id: CONTINUE_PIPELINE_ACTION_ID,
      label: "Continue Pipeline",
      kind: "external_launch",
      description:
        "Resume the next phase of an in-progress Shipwright pipeline.",
    } as ActionDefinition;
    return [...baseActionsList, synthetic];
  }, [baseActionsList, continuePipelineAvailable]);

  // Board empty-state CTA opens ONLY the real new-task action, never an arbitrary fallback (external-review fold).
  const newTaskAction = useMemo<ActionDefinition | null>(() => baseActionsList.find((a) => a.id === "new-task") ?? null, [baseActionsList]);

  // iterate 3.7h: client-side project filter against the single global
  // task list. ProjectFilterDropdown uses the same underlying cache entry,
  // so switching filters is a pure React re-render with no fetch wait.
  const projectFiltered = useMemo<ExternalTask[]>(() => {
    if (activeProjectId === null) return tasks;
    return tasks.filter((t) => t.projectId === activeProjectId);
  }, [tasks, activeProjectId]);

  // Status filter — iterate 3.7e-b1 (plan S1.4). Multi-select chip set;
  // empty = "All" (no filter). Stored in local React state (no URL params).
  const [statusFilter, setStatusFilter] = useState<Set<ExternalTaskState>>(
    () => new Set(),
  );
  const toggleStatus = useCallback((s: ExternalTaskState) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);
  const clearStatusFilter = useCallback(() => {
    setStatusFilter(new Set());
  }, []);

  const filteredTasks = useMemo<ExternalTask[]>(() => {
    if (statusFilter.size === 0) return projectFiltered;
    return projectFiltered.filter((t) => statusFilter.has(t.state));
  }, [projectFiltered, statusFilter]);

  // Per-state counts — computed on the project-filtered set (not the
  // status-filtered one) so the counts stay stable as the user clicks
  // chips. Matches GitHub/Linear filter-bar affordance.
  const statusCounts = useMemo<Record<ExternalTaskState, number>>(() => {
    const seed: Record<ExternalTaskState, number> = {
      draft: 0,
      awaiting_external_start: 0,
      active: 0,
      idle: 0,
      done: 0,
      launch_failed: 0,
      jsonl_missing: 0,
    };
    for (const t of projectFiltered) {
      if (t.state in seed) seed[t.state] += 1;
    }
    return seed;
  }, [projectFiltered]);

  // NewIssueModal state — singleton per page.
  const [modalAction, setModalAction] = useState<ActionDefinition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Set ONLY by the All-Projects cascade (the chosen project). null = flat /
  // single-project mode → modal tracks the active project as before.
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  // Continue Pipeline modal — separate singleton; routed from the same
  // dropdown but never overlaps with NewIssueModal.
  const [continuePipelineOpen, setContinuePipelineOpen] = useState(false);

  const openModal = useCallback((a: ActionDefinition, projectId?: string) => {
    if (a.id === CONTINUE_PIPELINE_ACTION_ID) {
      setContinuePipelineOpen(true);
      return;
    }
    setModalProjectId(projectId ?? null);
    setModalAction(a);
    setModalOpen(true);
  }, []);

  // The modal's catalog comes from the cascade-chosen project (cache-hit from
  // the cascade's own fetch) when set; else the resolved/active project.
  const modalActionsQuery = useProjectActions(modalProjectId ?? resolvedProjectId);

  // Global `i` shortcut — open the New Iterate modal (FR-03.14).
  useEffect(() => {
    const listener = (ev: KeyboardEvent) => {
      if (ev.key !== "i" && ev.key !== "I") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // Ignore while the user is typing in an input / textarea / contenteditable.
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }
      // Don't fire when the modal is already open (avoid re-opening on keystroke).
      if (modalOpen) return;

      const iterate = actionsList.find((a) => a.id === "new-iterate");
      if (iterate) {
        ev.preventDefault();
        openModal(iterate);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [actionsList, modalOpen, openModal]);

  return (
    <div
      className="flex h-full flex-col bg-[var(--color-bg)]"
      data-testid="task-board-page"
    >
      {/* A05: shared <PageHead> — 92px anthracite toolbar, uniform with every
          other page. The board's "title" is a project switcher + view toggle
          rather than a text heading, so it rides PageHead's `left` slot. The
          controls are styled for a WHITE bar via the legacy --color-* aliases;
          `chrome-dark-controls` flips those to light glass so they read on taupe
          (the surgical fix — one wrapper, not five component restyles). */}
      <PageHead
        testId="task-board-header"
        leftClassName="chrome-dark-controls"
        actionsClassName="chrome-dark-controls"
        left={
          <>
            {/* AC-1: on phones the project dropdown is portaled into the global
                top bar (below), so the header keeps only the view toggle and
                the AC-2 status-filter icon. */}
            {!isPhone && (
              <>
                <ProjectFilterDropdown />
                {/* Compliance Control-Grade pill for the single selected
                    project (FR-01.43). Hidden when "All projects" is active
                    (a grade is per-project, can't aggregate) or when the
                    project has no dashboard. */}
                {activeProjectId && (
                  <ComplianceGradeBadge projectId={activeProjectId} />
                )}
                <div
                  className="h-6 w-px bg-[var(--color-border)]"
                  aria-hidden="true"
                />
              </>
            )}
            <ViewToggle value={view} onChange={setView} />
            {isPhone && (
              <StatusFilterMenu
                counts={statusCounts}
                active={statusFilter}
                onToggle={toggleStatus}
                onReset={clearStatusFilter}
              />
            )}
          </>
        }
        actions={
          <CreateControls
            activeProjectId={activeProjectId}
            resolvedProjectId={resolvedProjectId}
            realProjects={realProjects}
            actionsList={actionsList}
            actionsLoading={actionsQuery.isLoading}
            previewEnabled={Boolean(actionsQuery.data?.preview.enabled)}
            previewReadyTimeoutSeconds={
              actionsQuery.data?.preview.ready_timeout_seconds ?? null
            }
            onSelect={openModal}
          />
        }
      />
      {isPhone &&
        topBarSlot?.slot &&
        createPortal(<ProjectFilterDropdown fluid />, topBarSlot.slot)}
      {/* Status pill row — ≥768px only. Kept on a LIGHT surface sub-strip below
          the taupe toolbar: the chips carry semantic tone colours (error/warn/
          success) that would fall below AA on anthracite — "a low-contrast grey
          is most tempting and most wrong" on dark chrome (AC5). On phones the
          same filter is the AC-2 icon menu in the toolbar above. */}
      {!isPhone && (
        <div
          style={{
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <StatusPillRow
            counts={statusCounts}
            active={statusFilter}
            onToggle={toggleStatus}
            onReset={clearStatusFilter}
          />
        </div>
      )}

      {/* Body — board (kanban) or list.
          R1 (iterate 3.7e-a Foundation): kanban body uses `.page-container`
          too — same 1600 max-width + 24 px L/R padding as the header above,
          so the header's first element and the first column share the same
          pixel offset from the sidebar. List view keeps its own internal
          layout (handled in TaskList).
          Iterate 3.7e-b1: gap-8 → gap-10 (32 → 40 px gutter). */}
      {/* Pipelines lane (campaign webui-pipeline-convergence W3). The lane host
          picks the representation by run mode: single_session → the campaign-like
          SingleSessionRunCard; multi_session / mode-less legacy → MasterTaskCard.
          Returns null for missing / v1 / invalid run-config (legacy flat-task
          path is unchanged) or when no project is resolved. */}
      <PipelineLaneCard runConfig={runConfigQuery.data} project={activeProjectMeta} />

      {/* FR-01.31/33 — Campaigns lane (extracted to CampaignsLane so the
          dismiss affordance has a home without growing this file). Hidden
          entirely when nothing is visible AND nothing is dismissed. */}
      <CampaignsLane projectId={resolvedProjectId} project={activeProjectMeta} />

      {isLoading ? (
        <div className="p-6 text-sm text-[var(--color-muted)]">Loading…</div>
      ) : view === "list" ? (
        // iterate 3.7h (Sven UAT): wrap TaskList in .page-container so the
        // table respects the same L/R gutters as the header + filter row.
        // `w-full` forces the container to stretch to parent width; without
        // it the page-container shrunk to the inner content width (was
        // 889px instead of the expected 1280) because TaskList's child
        // wrapper didn't force horizontal stretch.
        <div className="page-container w-full pt-10 pb-8">
          <TaskList tasks={filteredTasks} />
        </div>
      ) : projectFiltered.length === 0 ? (
        // A07 teaching empty state — only when the project has zero tasks (a filter that only hides tasks falls through to the columns).
        <TaskBoardEmptyState canCreate={Boolean(newTaskAction)} onCreate={() => newTaskAction && openModal(newTaskAction)} />
      ) : (
        // iterate-2026-06-17 — grid + grouping + drag-and-drop extracted to
        // TaskBoardColumns; grouping is by boardColumn (decoupled from state).
        <TaskBoardColumns tasks={filteredTasks} />
      )}

      <NewIssueModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        action={modalAction}
        projectActions={modalActionsQuery.data}
        initialProjectId={modalProjectId ?? undefined}
        onTaskCreated={() => {
          // Invalidate the external-tasks list so the new Draft row
          // appears immediately instead of waiting up to 2s for the
          // next refetchInterval tick. Phase A3 — iterate 3 remediation.
          void queryClient.invalidateQueries({ queryKey: ["external-tasks"] });
        }}
      />
      <ContinuePipelineModal
        open={continuePipelineOpen}
        onOpenChange={setContinuePipelineOpen}
        project={activeProjectMeta}
        runConfig={runConfigQuery.data}
      />
    </div>
  );
}
