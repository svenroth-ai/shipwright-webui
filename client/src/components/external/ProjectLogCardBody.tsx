/*
 * ProjectLogCardBody — the middle of a <ProjectLogCard> (A15, FR-01.59).
 *
 * The HONEST states (spec AC2/AC3):
 *   graded    → sparkline + stats + last-proof quote (real A02 data)
 *   error     → "Run history unavailable." (the read FAILED — we do NOT know
 *               the count, so we must never claim "no runs")
 *   sessions  → a "N sessions" line (no Shipwright runs, but the project has
 *               sessions — custom-action / non-Shipwright projects; Sven
 *               2026-07-17). We never nudge these to grade/adopt.
 *   known     → the ".lc-empty" nudge (a CONFIRMED zero-run, zero-session read)
 *   otherwise → a neutral loading placeholder (read still in flight)
 */

import { statsLine, type ProjectLogModel } from "../../lib/projectLogStats";
import { ProjectRunSparkline } from "./ProjectRunSparkline";

export function ProjectLogCardBody({
  projectId,
  model,
  runsError,
  runsKnown,
  taskCount,
}: {
  projectId: string;
  model: ProjectLogModel;
  runsError: boolean;
  /** A definitive answer for this project exists (resolved or synthesized). */
  runsKnown: boolean;
  /** Session (task) count for this project — drives the non-Shipwright state. */
  taskCount: number;
}) {
  if (model.graded) {
    return (
      <>
        <ProjectRunSparkline
          values={model.spark}
          label={`Run history — ${model.runs} run${model.runs === 1 ? "" : "s"}`}
        />
        <div className="lc-stats" data-testid={`projects-card-${projectId}-stats`}>
          {statsLine(model)}
        </div>
        {model.lastProof && (
          <div className="lc-proof">&ldquo;{model.lastProof}&rdquo;</div>
        )}
      </>
    );
  }
  if (runsError) {
    return (
      <div className="lc-empty" data-testid={`projects-card-${projectId}-unavailable`}>
        Run history unavailable.
      </div>
    );
  }
  if (runsKnown) {
    // No Shipwright runs, but the project has sessions → show them instead of
    // the grade/adopt nudge (the log works for custom-action projects too).
    if (taskCount > 0) {
      return (
        <div className="lc-empty" data-testid={`projects-card-${projectId}-sessions`}>
          {taskCount} session{taskCount === 1 ? "" : "s"} — open the log to view them.
        </div>
      );
    }
    return (
      <div className="lc-empty" data-testid={`projects-card-${projectId}-empty`}>
        No runs yet. Grade or adopt it to open the logbook.
      </div>
    );
  }
  return (
    <div
      className="lc-loading"
      aria-hidden="true"
      data-testid={`projects-card-${projectId}-loading`}
    />
  );
}
