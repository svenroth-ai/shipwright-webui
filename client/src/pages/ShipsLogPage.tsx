/*
 * ShipsLogPage — a project's HOME is its logbook (A16, FR-01.60). Route
 * `/projects/:projectId/log`, the destination A15's `openProjectLog()` seam
 * points at. Four parts, all read-only observers of A01/A02 + compliance:
 *
 *   1. the Captain's Drawer  — the control grade strip (CaptainsDrawer)
 *   2. the scoped-iterate promptbox + graduation card
 *   3. the logbook           — one entry per run (LogEntryList)
 *
 * Architecture fences: the WebUI never spawns Claude (rule 1 — the promptbox Go
 * is a CTA), never writes run_config / run_loop_state (DO-NOT #12), never writes
 * Claude's JSONL (DO-NOT #1). Everything here reads.
 */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LayoutGrid } from "lucide-react";

import { PageHead } from "../components/common/PageHead";
import { useProjects } from "../hooks/useProjects";
import { useProjectFilter } from "../hooks/useProjectFilter";
import { useProjectRuns } from "../hooks/useRunData";
import { getProjectColor } from "../lib/projectColor";
import { CaptainsDrawer } from "../components/shipslog/CaptainsDrawer";
import { ScopedIteratePromptbox } from "../components/shipslog/ScopedIteratePromptbox";
import { GraduationCard } from "../components/shipslog/GraduationCard";
import { LogEntryList } from "../components/shipslog/LogEntryList";
import "../styles/ships-log.css";

export default function ShipsLogPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { setActiveProjectId } = useProjectFilter();
  const { data: projects = [], isLoading } = useProjects();
  const { data: runsData } = useProjectRuns(projectId);

  const project = projects.find((p) => p.id === projectId);

  // The graduation baseline date = the project's FIRST recorded run (A02 returns
  // runs ts-desc, so the last row is the earliest). null → the card hides itself
  // (never a fabricated "Baseline set —").
  const baselineDate = useMemo(() => {
    if (runsData?.status !== "ok" || runsData.runs.length === 0) return null;
    const dated = runsData.runs.filter((r) => r.ts).map((r) => r.ts as string);
    return dated.length ? dated.reduce((a, b) => (a < b ? a : b)) : null;
  }, [runsData]);

  function openBoard() {
    setActiveProjectId(projectId);
    navigate(`/?projectId=${encodeURIComponent(projectId)}`);
  }

  if (!isLoading && !project) {
    return (
      <div className="flex h-full flex-col" data-testid="ships-log-page">
        <PageHead title="Ship's Log" sub="Project not found" testId="ships-log-header" />
        <div className="flex-1 overflow-y-auto">
          <div className="page-container" style={{ paddingTop: 24 }}>
            <p style={{ color: "var(--color-muted)" }}>
              This project is not registered.{" "}
              <button type="button" className="underline" onClick={() => navigate("/projects")}>
                Back to projects
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const color = project ? getProjectColor(project.id, project.settings?.color).hsl : "#8a8578";

  return (
    <div className="flex h-full flex-col" data-testid="ships-log-page">
      <PageHead
        testId="ships-log-header"
        title={
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block" }}
            />
            {project?.name ?? "Project"}
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 9px",
                borderRadius: 999,
                background: "var(--color-muted-bg)",
                color: "var(--color-muted)",
              }}
            >
              Ship&rsquo;s Log
            </span>
          </span>
        }
        sub="The logbook is this project's home — the accumulated proof between runs."
        actions={
          <button
            type="button"
            data-testid="ships-log-open-board"
            onClick={openBoard}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-muted-bg)]"
          >
            <LayoutGrid size={14} /> Open board
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="page-container" style={{ paddingTop: 24, paddingBottom: 32 }}>
          {project && (
            <div className="ships-log">
              <CaptainsDrawer projectId={project.id} />
              <div className="sl-lead">Start the next change — a new iterate on this project</div>
              <ScopedIteratePromptbox project={project} />
              <GraduationCard projectId={project.id} date={baselineDate} />
              <LogEntryList projectId={project.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
