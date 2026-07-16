/*
 * ProjectLogCard — a project rendered as a Ship's-Log PREVIEW card (A15,
 * FR-01.59). Replaces the old Projects table row. The log is the star:
 *
 *   .lc-top   dot · name · (grade pill | "Grade it")
 *   .lc-path  mono, truncated, full path in title=
 *   body      GRADED (A02 has runs) → sparkline + stats + last-proof quote
 *             UNGRADED               → the honest ".lc-empty" sentence
 *   .lc-foot  gear · trash · task count · "Open board ›"
 *
 * Data provenance (spec AC2/AC3): the body model is derived by
 * buildProjectLogModel() from A02's `RunsResponse` (passed in by the page so
 * the gallery fetches once and can sort graded-first) + the compliance score.
 * Nothing is fabricated — an ungraded project shows a sentence, never a chart.
 *
 * "Open board" routes through the single openProjectLog() seam (A16 re-points
 * it). "Grade it" navigates to the existing read-only Grade door
 * (/wizard/grade) — a REAL surface, no Claude spawn (rule 1), no hardcoded
 * slash-command (DO-NOT #11).
 */

import { useNavigate } from "react-router-dom";
import { ChevronRight, Settings as SettingsIcon, Target, Trash2 } from "lucide-react";

import { useProjectFilter } from "../../hooks/useProjectFilter";
import { useProjectCompliance } from "../../hooks/useProjectCompliance";
import { buildProjectLogModel } from "../../lib/projectLogStats";
import { openProjectLog } from "../../lib/projectNav";
import type { RunsResponse } from "../../lib/runDataApi";
import type { Project } from "../../types";
import { ComplianceGradeBadge } from "../compliance/ComplianceGradeBadge";
import { ProjectLogCardBody } from "./ProjectLogCardBody";

export interface ProjectLogCardProps {
  project: Project;
  /** A02 run bundle for this project (page-fetched via useQueries). */
  runs: RunsResponse | undefined;
  /** true once the A02 read has DEFINITIVELY resolved (isSuccess). */
  runsResolved: boolean;
  /** true when the A02 read failed — render "unavailable", never "no runs". */
  runsError: boolean;
  taskCount: number;
  /** Resolved dot colour (getProjectColor(...).hsl). */
  color: string;
  onOpenSettings: (project: Project) => void;
  onDelete: (
    e: React.MouseEvent,
    projectId: string,
    projectName: string,
  ) => void;
}

export function ProjectLogCard({
  project,
  runs,
  runsResolved,
  runsError,
  taskCount,
  color,
  onOpenSettings,
  onDelete,
}: ProjectLogCardProps) {
  const navigate = useNavigate();
  const { setActiveProjectId } = useProjectFilter();
  const { data: compliance, isPending: compliancePending } =
    useProjectCompliance(project.synthesized ? null : project.id);
  const hasGrade = compliance?.status === "ok";
  // Compliance settled to a non-ok state → offer "Grade it"; never flash it
  // while the read is still in flight (a synthesized row has no read at all).
  const complianceSettled = project.synthesized || !compliancePending;
  const model = buildProjectLogModel(runs, hasGrade ? compliance.score : null);
  // The run read is "known" (a definitive answer exists) when it resolved OR
  // the project is synthesized (which has no logbook by construction).
  const runsKnown = project.synthesized || runsResolved;

  function openLog() {
    if (project.synthesized) return;
    openProjectLog(project.id, { setActiveProjectId, navigate });
  }

  const countLabel =
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : "no tasks";

  return (
    <div
      className="card log-card glass-card"
      data-testid={`projects-card-${project.id}`}
      role="button"
      tabIndex={0}
      onClick={openLog}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openLog();
        }
      }}
      style={{ cursor: project.synthesized ? "default" : "pointer" }}
    >
      <div className="lc-top">
        <span className="dot" aria-hidden="true" style={{ background: color }} />
        <span className="lc-name" title={project.name}>
          {project.name}
          {project.synthesized && <span className="lc-synth"> (synthesized)</span>}
        </span>
        <span className="grow" />
        {project.synthesized ? null : hasGrade ? (
          <ComplianceGradeBadge projectId={project.id} />
        ) : complianceSettled ? (
          <button
            type="button"
            className="lc-gradeit"
            data-testid={`projects-gradeit-${project.id}`}
            title="Grade this project — opens the read-only Grade tool"
            onClick={(e) => {
              e.stopPropagation();
              navigate("/wizard/grade");
            }}
          >
            <Target size={13} /> Grade it
          </button>
        ) : null}
      </div>

      <div className="lc-path" title={project.path || "(synthesized)"}>
        {project.path || "—"}
      </div>

      <ProjectLogCardBody
        projectId={project.id}
        model={model}
        runsError={runsError && !project.synthesized}
        runsKnown={runsKnown}
      />

      <div className="lc-foot">
        {!project.synthesized && (
          <>
            <button
              type="button"
              className="lc-icon-btn"
              data-testid={`projects-settings-${project.id}`}
              aria-label="Project settings"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings(project);
              }}
            >
              <SettingsIcon size={14} />
            </button>
            <button
              type="button"
              className="lc-icon-btn danger"
              data-testid={`projects-delete-${project.id}`}
              aria-label="Remove project"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e, project.id, project.name);
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        <span className="grow" />
        <span
          className="lc-count"
          data-testid={`projects-card-${project.id}-tasks`}
        >
          {countLabel}
        </span>
        {!project.synthesized && (
          <button
            type="button"
            className="lc-open"
            data-testid={`projects-open-${project.id}`}
            onClick={(e) => {
              e.stopPropagation();
              openLog();
            }}
          >
            Open board <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
