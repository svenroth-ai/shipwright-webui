/*
 * SingleSessionRunCard — the campaign-like board card for a single-session
 * pipeline run (campaign webui-pipeline-convergence, sub-iterate W3).
 *
 * Rendered by <PipelineLaneCard> when `resolveRunMode(config) ===
 * "single_session"`. Mirrors <CampaignLaneCard>'s shape — a steady progress bar
 * on top + an ordered checklist + ONE Launch/Resume CTA — INSTEAD of the
 * multi-session <MasterTaskCard>'s per-row green Continue buttons. The
 * `/shipwright-run` master drives every phase via a phase-runner subagent in one
 * conversation, so there is deliberately NO per-phase Continue here (design spec
 * §5 "single-session gets the campaign look").
 *
 *   - Progress bar: `derivePhaseProgress` — steady high-water frontier over the
 *     canonical `config.pipeline` (monotonic across the build fan-out).
 *   - Checklist: the REAL, growing `config.phase_tasks` list (fan-out visible).
 *   - CTA: <MasterRunLaunchButton> (Launch → Resume → hidden when terminal).
 *
 * Phase names come from `config.phase_tasks` (data-driven — no hardcoded phase
 * strings, DO-NOT guard #11).
 */

import { Check, ChevronRight, Circle, Loader2, Play, XCircle, AlertTriangle } from "lucide-react";

import type { Project } from "../../types";
import {
  formatRunLabel,
  isTerminalRunStatus,
  type PhaseTaskStatus,
  type RunConfigDiagnostics,
  type RunConfigV2,
  type RunStatus,
} from "../../lib/run-config-v2";
import { derivePhaseProgress } from "../../lib/pipelineProgress";
import { useDesignGate } from "../../hooks/useDesignGate";
import { MasterRunLaunchButton } from "./MasterRunLaunchButton";
import { DesignGatePanel } from "./DesignGatePanel";

const RUN_STATUS_PALETTE: Record<RunStatus, { bg: string; fg: string }> = {
  in_progress: { bg: "#dbeafe", fg: "#1e40af" },
  complete: { bg: "#d1fae5", fg: "#065f46" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
  needs_validation: { bg: "#fef3c7", fg: "#78350f" },
};

function RunStatusBadge({ status }: { status: RunStatus }) {
  const palette = RUN_STATUS_PALETTE[status];
  return (
    <span
      data-testid={`single-session-run-status-${status}`}
      className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PhaseTaskIcon({ status }: { status: PhaseTaskStatus }) {
  switch (status) {
    case "done":
      return <Check size={14} className="shrink-0 text-[var(--color-success-text,#16a34a)]" aria-label="done" />;
    case "skipped":
      return <Check size={13} className="shrink-0 text-[var(--color-muted)]" aria-label="skipped" />;
    case "in_progress":
      return <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-warning-text,#b45309)]" aria-label="in progress" />;
    case "awaiting_launch":
      return <Play size={13} className="shrink-0 text-[var(--color-primary)]" aria-label="awaiting launch" />;
    case "failed":
      return <XCircle size={13} className="shrink-0 text-[var(--color-error,#dc2626)]" aria-label="failed" />;
    default:
      return <Circle size={12} className="shrink-0 text-[var(--color-muted)]" aria-label="backlog" />;
  }
}

/** Status text only where it adds signal (mirrors CampaignLaneCard). */
function statusNote(status: PhaseTaskStatus): { text: string; tone: "warn" | "error" } | null {
  if (status === "in_progress") return { text: "in progress", tone: "warn" };
  if (status === "awaiting_launch") return { text: "awaiting launch", tone: "warn" };
  if (status === "failed") return { text: "failed", tone: "error" };
  return null;
}

export function SingleSessionRunCard({
  project,
  config,
  diagnostics,
}: {
  project: Project;
  config: RunConfigV2;
  diagnostics: RunConfigDiagnostics;
}) {
  const progress = derivePhaseProgress(config);

  // Design gate — only poll while the run is live (never for a terminal run).
  const designGate = useDesignGate(project?.id, !isTerminalRunStatus(config.status));

  return (
    <div
      data-testid={`single-session-run-card-${config.runId}`}
      data-run-status={config.status}
      className="flex flex-col gap-2 rounded-[var(--radius-card,12px)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      {/* Header — run label + status badge + N/total phases. */}
      <div className="flex items-center gap-2">
        <ChevronRight size={14} className="shrink-0 text-[var(--color-muted)]" aria-hidden="true" />
        <span className="truncate font-semibold text-[13px] text-[var(--color-text,#111827)]">
          {formatRunLabel(config.runId)}
        </span>
        <RunStatusBadge status={config.status} />
        <span
          className="ml-auto shrink-0 text-[11px] font-semibold text-[var(--color-muted)]"
          data-testid={`single-session-progress-${config.runId}`}
        >
          {progress.donePhases}/{progress.totalPhases}
        </span>
      </div>

      {/* Diagnostics banner — parity with MasterTaskCard. */}
      {diagnostics.droppedPhaseTaskIds.length > 0 && (
        <div
          data-testid={`single-session-diagnostics-${config.runId}`}
          className="flex items-start gap-2 rounded-[var(--radius-button,8px)] bg-[#fef3c7] px-2.5 py-1.5 text-[11px] text-[#78350f]"
        >
          <AlertTriangle size={12} className="mt-[2px] shrink-0" />
          <span>
            {diagnostics.droppedPhaseTaskIds.length} phase_task entries unreadable in run-config.
          </span>
        </div>
      )}

      {/* Steady 7-phase progress bar. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted-bg)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      {/* Phase-task checklist — the real, fanning-out list. NO per-row Continue. */}
      <ol className="flex flex-col gap-1">
        {config.phase_tasks.map((pt) => {
          const note = statusNote(pt.status);
          const doneLike = pt.status === "done" || pt.status === "skipped";
          return (
            <li
              key={pt.phaseTaskId}
              data-testid={`single-session-phase-${pt.phaseTaskId}`}
              data-status={pt.status}
              className="flex min-w-0 items-center gap-2 text-[12px]"
            >
              <PhaseTaskIcon status={pt.status} />
              <span
                className={
                  "min-w-0 truncate " +
                  (doneLike
                    ? "text-[var(--color-muted)] line-through"
                    : "text-[var(--color-text,#111827)]")
                }
              >
                {pt.phase}
                {pt.splitId ? <span className="text-[var(--color-muted)]"> / {pt.splitId}</span> : null}
              </span>
              {note && (
                <span
                  className={
                    note.tone === "error"
                      ? "shrink-0 text-[10px] text-[var(--color-error,#dc2626)]"
                      : "shrink-0 text-[10px] text-[var(--color-warning-text,#b45309)]"
                  }
                >
                  {note.text}
                </span>
              )}
            </li>
          );
        })}
        {config.phase_tasks.length === 0 && (
          <li className="text-[12px] text-[var(--color-muted)]">
            No phase tasks yet — Launch to start the pipeline.
          </li>
        )}
      </ol>

      {/* Paused-at-design-gate affordance — Review mockups + feedback write
          (FR-01.45). Rendered only when the gate is active AND the run is live
          (never off stale cached gate data for a terminal run); Resume below
          applies the feedback. */}
      {!isTerminalRunStatus(config.status) && designGate.data?.active && project?.id && (
        <DesignGatePanel projectId={project.id} />
      )}

      {/* Single Launch / Resume CTA (hidden when the run is terminal). */}
      <MasterRunLaunchButton project={project} config={config} />
    </div>
  );
}
