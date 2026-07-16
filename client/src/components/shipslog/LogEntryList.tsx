/*
 * LogEntryList — the Ship's-Log logbook sheet (A16, FR-01.60). One row per run
 * from A02 (`useProjectRuns`), each an entry into its Mission.
 *
 * Provenance honesty (spec AC3/AC6):
 *   - Rows are `reader` data from A02 — NEVER the prototype's demo literals
 *     (`209 runs`, the three hardcoded green gate dots). An empty/unreadable
 *     event log renders the honest empty sheet, never fabricated rows.
 *   - THE JOIN IS THE RISK: a run maps to a task by `runId == task.runId`. A run
 *     with NO joined task is rendered NON-clickable (a <div>, no navigate) — it
 *     is never a dead router push into a 404.
 *   - Gate dots appear ONLY when A02 actually reports gate outcomes for a run
 *     (`run.gates != null`); no outcomes → no dots. The lamps are DERIVED
 *     (`gates.derived: true`), shown as such by tone, never as a producer verdict.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { useProjectRuns } from "../../hooks/useRunData";
import { useExternalTasks } from "../../hooks/useExternalTasks";
import type { RunDataJoin, RunGates } from "../../lib/runDataApi";

const GATE_ORDER: Array<keyof Pick<RunGates, "review" | "test" | "security">> = [
  "review",
  "test",
  "security",
];

/** ISO ts → "Jul 12"; "" when absent/unparseable (rendered as a dash). */
function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function intentOf(run: RunDataJoin): string {
  return run.intent || run.changeType || "change";
}

export function LogEntryList({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data: runsData } = useProjectRuns(projectId);
  const { data: tasks = [] } = useExternalTasks({ projectId });

  // The run→task join (AC3). Keyed by `task.runId == adr_id == run.runId`.
  const taskByRunId = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) if (t.runId) m.set(t.runId, t.taskId);
    return m;
  }, [tasks]);

  const runs = runsData?.status === "ok" ? runsData.runs : [];

  return (
    <div className="sheet" data-testid="shipslog-logbook">
      <div className="sheet-h">
        <span className="heading">The logbook</span>
        <span className="caption">every run is an entry</span>
        <span className="grow" />
        <span className="caption">gates: review · tests · security</span>
      </div>
      <div className="sheet-body">
        {runs.length === 0 ? (
          <div className="sl-empty" data-testid="shipslog-logbook-empty">
            No runs recorded yet — the logbook fills as Shipwright works this project.
          </div>
        ) : (
          runs.map((run) => {
            const taskId = taskByRunId.get(run.runId);
            return (
              <LogEntry
                key={run.runId}
                run={run}
                onOpen={taskId ? () => navigate(`/tasks/${taskId}`) : undefined}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function LogEntry({ run, onOpen }: { run: RunDataJoin; onOpen?: () => void }) {
  const frs = run.affectedFrs ?? [];
  const fr = frs[0];
  const commit = (run.commit ?? "").slice(0, 7);
  const clickable = Boolean(onOpen);

  const body = (
    <>
      <span className="le-date">{fmtDate(run.ts)}</span>
      <span className="le-badge" data-intent={intentOf(run)}>
        {intentOf(run)}
      </span>
      <span className="le-title">{run.summary || run.runId}</span>
      {fr && (
        <span className="le-pill">
          {fr}
          {frs.length > 1 ? ` +${frs.length - 1}` : ""}
        </span>
      )}
      {run.gates && (
        <span className="gates" data-testid={`shipslog-gates-${run.runId}`}>
          {GATE_ORDER.map((g) => (
            <span key={g} className="gate-dot" data-state={run.gates![g]} title={`${g}: ${run.gates![g]}`} />
          ))}
        </span>
      )}
      {commit && <span className="le-commit">{commit}</span>}
      {clickable && <ChevronRight className="le-chev" size={15} />}
    </>
  );

  const testid = `shipslog-entry-${run.runId}`;
  if (clickable) {
    return (
      <button type="button" className="logentry" data-testid={testid} data-clickable="true" onClick={onOpen}>
        {body}
      </button>
    );
  }
  // AC3 — a run with no joined task is NOT a dead click.
  return (
    <div className="logentry" data-testid={testid} data-clickable="false" title="No Mission linked to this run yet">
      {body}
    </div>
  );
}
