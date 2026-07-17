/*
 * Projects — the registered projects rendered as a Ship's-Log GALLERY (A15,
 * FR-01.59). Replaces the six-column table (iterate 3.7e-b3) with a grid of
 * <ProjectLogCard>s: each project is a preview of its own logbook, and the log
 * is the star. Graded projects (a real logbook — A02 returns runs) lead; a
 * board of many mixed projects never becomes a wall of empty cards.
 *
 * The page owns: the title bar (count + Create), the teaching empty state, the
 * per-project task-count join, the wizard + settings dialog, and delete (with
 * the task-cascade confirm). It fans out one A02 run query per project via
 * `useQueries` so cards fetch once and the gallery can sort graded-first.
 *
 * Load-bearing testids preserved: projects-page, projects-create-button,
 * projects-empty(-sentence), projects-header-count, projects-settings-<id>,
 * projects-delete-<id>, aria-label="Project settings". The old table testids
 * (projects-table / projects-row-<id> / projects-cell-<id>-*) are REPLACED by
 * projects-gallery / projects-card-<id> / projects-card-<id>-{tasks,stats,empty}.
 *
 * DO-NOT #12 (never write run_config), rule 1 (never spawn Claude), rule 23
 * (never touch state/boardColumn): this page is a pure read-only observer.
 */
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Plus, FolderOpen } from "lucide-react";

import { useProjects } from "../hooks/useProjects";
import { useDeleteProject } from "../hooks/useDeleteProject";
import { useExternalTasks } from "../hooks/useExternalTasks";
import { projectRunsQueryOptions } from "../hooks/useRunData";
import { ProjectWizard } from "../components/wizard/ProjectWizard";
import { ProjectSettingsDialog } from "../components/wizard/ProjectSettingsDialog";
import { PageHead } from "../components/common/PageHead";
import { DensityToggle } from "../components/command/DensityToggle";
import { ProjectLogCard } from "../components/external/ProjectLogCard";
import { getProjectColor } from "../lib/projectColor";
import type { RunsResponse } from "../lib/runDataApi";
import type { Project } from "../types";
import "../styles/projects-gallery.css";

export default function ProjectsPage() {
  const { data: projects = [], isLoading } = useProjects();
  const { data: tasks = [] } = useExternalTasks({ projectId: null });
  const [showWizard, setShowWizard] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Project | null>(null);
  const deleteProject = useDeleteProject();

  // One A02 run bundle per project (synthesized rows disabled). useQueries is
  // built for a dynamic-length fan-out; the shared options builder keeps the
  // cache key identical to useProjectRuns so cards never double-fetch.
  const runQueries = useQueries({
    queries: projects.map((p) =>
      projectRunsQueryOptions(p.synthesized ? null : p.id),
    ),
  });
  const runsByProject = useMemo(() => {
    const m = new Map<
      string,
      { data: RunsResponse | undefined; resolved: boolean; error: boolean }
    >();
    projects.forEach((p, i) => {
      const q = runQueries[i];
      m.set(p.id, {
        data: q?.data,
        resolved: q?.isSuccess ?? false,
        error: q?.isError ?? false,
      });
    });
    return m;
  }, [projects, runQueries]);

  // Per-project task count. Memoized so re-renders don't rehash on every card.
  const taskCountByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      const pid = t.projectId ?? "unassigned";
      m.set(pid, (m.get(pid) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  // Graded-first: a project with a real logbook (runCount > 0) leads. Stable —
  // registry order is preserved within each group (decorate-sort-undecorate).
  const ordered = useMemo(() => {
    const graded = (p: Project) =>
      (runsByProject.get(p.id)?.data?.runCount ?? 0) > 0 ? 1 : 0;
    return projects
      .map((p, i) => ({ p, i }))
      .sort((a, b) => graded(b.p) - graded(a.p) || a.i - b.i)
      .map((x) => x.p);
  }, [projects, runsByProject]);

  function handleDelete(
    e: React.MouseEvent,
    projectId: string,
    projectName: string,
  ) {
    e.stopPropagation();
    // iterate-2026-07-06 — warn how many tasks the server-side cascade removes.
    const n = taskCountByProject.get(projectId) ?? 0;
    const note =
      n > 0
        ? `\n\n${n} task${n === 1 ? "" : "s"} belonging to this project will also be removed from the board.`
        : "";
    if (
      confirm(
        `Remove "${projectName}" from the WebUI?${note}\n\nProject files on disk (and Claude transcripts) are NOT deleted.`,
      )
    ) {
      deleteProject.mutate(projectId);
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "var(--color-bg)" }}
      data-testid="projects-page"
    >
      <PageHead
        title="Projects"
        small={
          projects.length > 0 ? (
            <span data-testid="projects-header-count">
              ({projects.length} total)
            </span>
          ) : undefined
        }
        testId="projects-header"
        actions={
          <>
            <DensityToggle />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
              style={{ background: "var(--color-primary)" }}
              onClick={() => setShowWizard(true)}
              data-testid="projects-create-button"
            >
              <Plus size={16} /> Create Project
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div
          className="page-container"
          style={{ paddingTop: "24px", paddingBottom: "24px" }}
        >
          {isLoading ? (
            <div className="log-gallery">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="animate-pulse"
                  style={{
                    height: "168px",
                    background: "var(--color-muted-bg)",
                    borderRadius: "16px",
                  }}
                />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div
              className="flex flex-col items-center text-center"
              style={{ padding: "64px 16px", color: "var(--color-muted)" }}
              data-testid="projects-empty"
            >
              <FolderOpen size={48} className="mb-3 opacity-50" />
              <p className="text-lg" style={{ color: "var(--color-text)" }}>
                No projects yet
              </p>
              {/* A07 teaching empty state — one sentence + exactly one action. */}
              <p className="text-sm mb-4" data-testid="projects-empty-sentence">
                Each project&rsquo;s logbook — the accumulated proof between runs.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
                style={{ background: "var(--color-primary)" }}
                onClick={() => setShowWizard(true)}
              >
                <Plus size={16} /> Create Project
              </button>
            </div>
          ) : (
            <div className="log-gallery density-surface" data-testid="projects-gallery">
              {ordered.map((project) => {
                const rq = runsByProject.get(project.id);
                return (
                  <ProjectLogCard
                    key={project.id}
                    project={project}
                    runs={rq?.data}
                    runsResolved={rq?.resolved ?? false}
                    runsError={rq?.error ?? false}
                    taskCount={taskCountByProject.get(project.id) ?? 0}
                    color={
                      getProjectColor(project.id, project.settings?.color).hsl
                    }
                    onOpenSettings={setSettingsFor}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ProjectWizard open={showWizard} onOpenChange={setShowWizard} />
      <ProjectSettingsDialog
        project={settingsFor}
        open={settingsFor !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsFor(null);
        }}
      />
    </div>
  );
}
