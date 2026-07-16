/*
 * ProjectLogCardBody — the middle of a <ProjectLogCard> (A15, FR-01.59).
 *
 * The four HONEST states (spec AC2/AC3):
 *   graded    → sparkline + stats + last-proof quote (real A02 data)
 *   error     → "Run history unavailable." (the read FAILED — we do NOT know
 *               the count, so we must never claim "no runs")
 *   known     → the ".lc-empty" sentence (a CONFIRMED zero-run read)
 *   otherwise → a neutral loading placeholder (read still in flight)
 */

import { statsLine, type ProjectLogModel } from "../../lib/projectLogStats";
import { ProjectRunSparkline } from "./ProjectRunSparkline";

export function ProjectLogCardBody({
  projectId,
  model,
  runsError,
  runsKnown,
}: {
  projectId: string;
  model: ProjectLogModel;
  runsError: boolean;
  /** A definitive answer for this project exists (resolved or synthesized). */
  runsKnown: boolean;
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
    return (
      <div className="lc-empty" data-testid={`projects-card-${projectId}-empty`}>
        No runs yet — grade it to open the logbook.
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
