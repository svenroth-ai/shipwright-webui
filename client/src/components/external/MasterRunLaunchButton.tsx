/*
 * MasterRunLaunchButton — the single-session pipeline card's ONE state-aware CTA
 * (campaign webui-pipeline-convergence, sub-iterate W3).
 *
 * Mirrors the campaign lane's launch buttons but for the `/shipwright-run`
 * master: create-or-reuse the run's master shadow → launch → sessionStorage
 * handoff → navigate to its TaskDetail terminal (all via W2's
 * `useLaunchMasterRun`; the server is the sole command author, regression guard
 * #19). There is NO per-phase Continue — the master drives every phase.
 *
 * State-aware label (user decision, 2026-07-09):
 *   - run terminal (complete / failed) → renders NOTHING (the full/red bar is
 *     the whole story). This hide is the UI's own choice; separately the launch
 *     route's O20 idempotency guard refuses a task whose `state === "done"`
 *     (a different concept from run `status === "complete"`).
 *   - established master (its `<uuid>.jsonl` observed) → "Resume".
 *   - otherwise → "Launch".
 * Labels stay singular (never "Relaunch") — disclosure lives in the tooltip
 * (feedback_resume_label_singular). Disabled (never a dead button) when no
 * project resolves.
 */

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";

import type { Project } from "../../types";
import { isTerminalRunStatus, type RunConfigV2 } from "../../lib/run-config-v2";
import { useExternalTasks } from "../../hooks/useExternalTasks";
import {
  useLaunchMasterRun,
  type LaunchMasterRunResult,
} from "../../hooks/useLaunchMasterRun";

function errorMessage(result: Extract<LaunchMasterRunResult, { ok: false }>): string {
  const base =
    result.reason === "create_failed"
      ? "Could not create the master task."
      : "Launch failed.";
  return result.detail ? `${base} (${result.detail})` : base;
}

export function MasterRunLaunchButton({
  project,
  config,
}: {
  project: Project | null | undefined;
  config: RunConfigV2;
}) {
  const navigate = useNavigate();
  const launchMasterRun = useLaunchMasterRun();
  const { data: tasks = [] } = useExternalTasks();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Terminal run → no CTA (the full/red bar is the whole story).
  if (isTerminalRunStatus(config.status)) return null;

  const masterShadow = tasks.find(
    (t) => t.parentRunMaster === true && t.runId === config.runId,
  );
  // An established master (JSONL observed) resumes; anything else is a fresh
  // launch. `useLaunchMasterRun` self-selects the same way — the label just
  // mirrors it so the button reads true.
  const established = Boolean(masterShadow?.firstJsonlObservedAt);
  const label = established ? "Resume" : "Launch";
  const canLaunch = Boolean(project);

  const onClick = async () => {
    if (inFlight.current || !project) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await launchMasterRun({
      project: { id: project.id, path: project.path },
      config: { runId: config.runId },
      tasks,
    });
    if (result.ok) {
      navigate(`/tasks/${result.taskId}`);
      return;
    }
    setError(errorMessage(result));
    setSubmitting(false);
    inFlight.current = false;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={!canLaunch || submitting}
        data-testid={`master-run-launch-${config.runId}`}
        data-mode={established ? "resume" : "launch"}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        title={
          !canLaunch
            ? "No project resolved — cannot launch the pipeline master."
            : established
              ? "Re-open the running pipeline master in the embedded terminal."
              : "Open a terminal and run the /shipwright-run master, which drives every phase."
        }
      >
        <Play size={12} />
        {submitting ? "Launching…" : label}
      </button>
      {error && (
        <span
          data-testid={`master-run-launch-error-${config.runId}`}
          className="text-[11px] text-[var(--color-error,#dc2626)]"
        >
          {error}
        </span>
      )}
    </div>
  );
}
