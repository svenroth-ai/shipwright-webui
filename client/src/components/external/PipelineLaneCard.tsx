/*
 * PipelineLaneCard — the Task Board's "Pipelines" lane host (campaign
 * webui-pipeline-convergence, sub-iterate W3). Symmetric with <CampaignsLane>:
 * a self-contained lane that TaskBoardPage renders unconditionally (it returns
 * null when there is nothing to show), keeping the grandfathered TaskBoardPage
 * from growing.
 *
 * Picks the representation by run mode (`resolveRunMode`):
 *   - single_session → <SingleSessionRunCard> — the campaign-like card (progress
 *     bar + phase checklist + one Launch/Resume CTA).
 *   - multi_session / mode-less legacy → <MasterTaskCard> — the UNCHANGED
 *     per-phase-Continue card (deprecated; removal is triage trg-0e8e7f90).
 *
 * WebUI is a READ-ONLY observer of run_config (CLAUDE.md rule 12).
 */

import type { Project } from "../../types";
import { resolveRunMode, type RunConfigResponse } from "../../lib/run-config-v2";
import { MasterTaskCard } from "./MasterTaskCard";
import { SingleSessionRunCard } from "./SingleSessionRunCard";

export function PipelineLaneCard({
  runConfig,
  project,
}: {
  runConfig: RunConfigResponse | undefined;
  project: Project | null;
}) {
  // Missing / v1_legacy / invalid → no lane (legacy flat-task path unchanged);
  // no resolved project → nothing to launch against.
  if (!runConfig || runConfig.status !== "ok" || !project) return null;
  const { config, readyToLaunchTasks, diagnostics } = runConfig;

  return (
    <div
      className="page-container flex w-full flex-col gap-3 pt-6 pb-2"
      data-testid="task-board-pipelines-lane"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted,#6b7280)]">
        Pipelines
      </div>
      {resolveRunMode(config) === "single_session" ? (
        <SingleSessionRunCard project={project} config={config} diagnostics={diagnostics} />
      ) : (
        <MasterTaskCard
          project={project}
          config={config}
          readyToLaunchTasks={readyToLaunchTasks}
          diagnostics={diagnostics}
        />
      )}
    </div>
  );
}
