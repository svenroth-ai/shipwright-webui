/*
 * Master TaskCard — one card per Run from the framework's
 * shipwright_run_config.json (schemaVersion 2).
 *
 * Layout (top to bottom):
 *   1. Header: Run-<short> label + run-status pill + chips (security,
 *      splitMode, splits frozen)
 *   2. Diagnostics banner (when readers dropped phase_task rows)
 *   3. Body: collapsible phase_tasks list — phase[/splitId] · status pill
 *      · sessionUuid suffix · per-row Continue CTA on awaiting_launch
 *   4. Footer: state-conditional UX
 *      - failed         → red banner + recover snippets per failed task
 *      - needs_validation → amber banner + recover snippets per non-terminal
 *      - complete       → green banner + deploy artifacts (best effort)
 *      - stale in_progress → amber inline warning + recover snippet
 *
 * Continuation CTA delegates to `useContinuePipeline()` so the same
 * surgical path runs whether the user clicks here, in the menu, or in a
 * future TaskDetail header (review O #7 / plan B4).
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import type { Project } from "../../types";
import {
  formatRunLabel,
  isTerminalPhaseTaskStatus,
  type PhaseTask,
  type PhaseTaskStatus,
  type RunConfigDiagnostics,
  type RunConfigV2,
  type RunStatus,
} from "../../lib/run-config-v2";
import { useContinuePipeline } from "../../hooks/useContinuePipeline";
import { useExternalTasks } from "../../hooks/useExternalTasks";
import type { ExternalTask } from "../../lib/externalApi";
import { CopySnippet } from "./CopySnippet";

const STALE_IN_PROGRESS_MS = 60 * 60 * 1000; // 1 hour

interface Props {
  project: Project;
  config: RunConfigV2;
  readyToLaunchTasks: PhaseTask[];
  diagnostics: RunConfigDiagnostics;
}

export function MasterTaskCard({
  project,
  config,
  readyToLaunchTasks,
  diagnostics,
}: Props) {
  const navigate = useNavigate();
  const continuePipeline = useContinuePipeline();
  const { data: tasks = [] } = useExternalTasks();
  const [expanded, setExpanded] = useState(config.status === "in_progress");
  const [pendingPhaseTaskId, setPendingPhaseTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build a sessionUuid → shadow-task lookup so child rows can navigate
  // to the corresponding TaskDetail when a webui shadow exists. Rows
  // without a shadow (e.g. phase_tasks the user has never continued via
  // webui — orchestrator-tracked but no JSONL polling here) stay
  // non-interactive.
  const shadowBySessionUuid = useMemo(() => {
    const m = new Map<string, ExternalTask>();
    for (const t of tasks) m.set(t.sessionUuid, t);
    return m;
  }, [tasks]);

  const failedTasks = useMemo(
    () => config.phase_tasks.filter((t) => t.status === "failed"),
    [config.phase_tasks],
  );
  const nonTerminalTasks = useMemo(
    () => config.phase_tasks.filter((t) => !isTerminalPhaseTaskStatus(t.status)),
    [config.phase_tasks],
  );
  const staleTasks = useMemo(
    () => detectStaleTasks(config),
    [config],
  );

  const onContinue = async (phaseTaskId: string) => {
    setPendingPhaseTaskId(phaseTaskId);
    setError(null);
    try {
      const result = await continuePipeline({ project, phaseTaskId });
      if (!result.ok) {
        setError(reasonToMessage(result.reason, result.detail));
        return;
      }
      navigate(`/tasks/${result.taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingPhaseTaskId(null);
    }
  };

  return (
    <div
      data-testid={`master-task-card-${config.runId}`}
      data-run-status={config.status}
      className="rounded-[var(--radius-card,12px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-surface,#fff)] shadow-[var(--shadow-card,0_2px_6px_rgba(0,0,0,0.06))]"
      style={{ overflow: "hidden" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse phase tasks" : "Expand phase tasks"}
          data-testid={`master-task-card-toggle-${config.runId}`}
          className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-semibold text-[14px] text-[var(--color-text,#1a1a1a)]">
            {formatRunLabel(config.runId)}
          </span>
          <RunStatusBadge status={config.status} />
          {config.runConditions.splitMode && (
            <Chip data-testid={`master-card-chip-split-${config.runId}`}>
              {config.runConditions.splitMode === "per_split"
                ? `${config.splits_frozen.length} split${
                    config.splits_frozen.length === 1 ? "" : "s"
                  }`
                : "single pass"}
            </Chip>
          )}
          {config.runConditions.securityEnabled && (
            <Chip data-testid={`master-card-chip-security-${config.runId}`}>security</Chip>
          )}
        </div>
      </div>

      {diagnostics.droppedPhaseTaskIds.length > 0 && (
        <div
          data-testid={`master-card-diagnostics-${config.runId}`}
          className="flex items-start gap-2 border-b border-[var(--color-border,#e0dbd4)] bg-[#fef3c7] px-4 py-2 text-[12px] text-[#78350f]"
        >
          <AlertTriangle size={13} className="mt-[2px] shrink-0" />
          <div>
            <strong className="font-semibold">
              {diagnostics.droppedPhaseTaskIds.length} phase_task entries unreadable
            </strong>{" "}
            in run-config — see server logs / re-run /shipwright-run if pipeline appears wedged.
          </div>
        </div>
      )}

      {expanded && (
        <ul
          data-testid={`master-card-children-${config.runId}`}
          className="divide-y divide-[var(--color-border,#e0dbd4)]"
        >
          {config.phase_tasks.map((pt) => {
            const shadow = shadowBySessionUuid.get(pt.sessionUuid);
            const navigable = shadow !== undefined;
            const onRowActivate = navigable
              ? () => navigate(`/tasks/${shadow.taskId}`)
              : undefined;
            const onRowKey = navigable
              ? (ev: KeyboardEvent<HTMLLIElement>) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onRowActivate?.();
                  }
                }
              : undefined;
            return (
              <li
                key={pt.phaseTaskId}
                data-testid={`master-card-row-${pt.phaseTaskId}`}
                data-navigable={navigable ? "true" : "false"}
                role={navigable ? "button" : undefined}
                tabIndex={navigable ? 0 : undefined}
                onClick={onRowActivate}
                onKeyDown={onRowKey}
                aria-label={
                  navigable
                    ? `Open task detail for ${pt.phase}${pt.splitId ? ` / ${pt.splitId}` : ""}`
                    : undefined
                }
                className={
                  "flex items-center gap-3 px-4 py-2 text-[13px] " +
                  (navigable
                    ? "cursor-pointer hover:bg-[var(--color-muted-bg,#ede8e1)] focus:bg-[var(--color-muted-bg,#ede8e1)] focus:outline-none"
                    : "")
                }
              >
                <PhaseDot phase={pt.phase} />
                <span className="font-medium text-[var(--color-text,#1a1a1a)]">
                  {pt.phase}
                  {pt.splitId ? (
                    <span className="text-[var(--color-muted,#6b7280)]"> / {pt.splitId}</span>
                  ) : null}
                </span>
                <PhaseTaskBadge status={pt.status} />
                <span className="ml-auto font-mono text-[11px] text-[var(--color-muted,#6b7280)]">
                  {pt.sessionUuid.slice(-8)}
                </span>
                {pt.status === "awaiting_launch" && (
                  <button
                    type="button"
                    data-testid={`master-card-continue-${pt.phaseTaskId}`}
                    onClick={(ev) => {
                      // Don't bubble to row navigation — Continue is the
                      // primary action on this row regardless of whether
                      // a shadow already exists.
                      ev.stopPropagation();
                      void onContinue(pt.phaseTaskId);
                    }}
                    disabled={pendingPhaseTaskId === pt.phaseTaskId}
                    className="rounded-[var(--radius-button,8px)] bg-[var(--color-success,#059669)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingPhaseTaskId === pt.phaseTaskId ? "…" : "Continue"}
                  </button>
                )}
                {pt.status === "failed" && (
                  <span className="text-[11px] font-medium text-[#b91c1c]">failed</span>
                )}
              </li>
            );
          })}
          {readyToLaunchTasks.length === 0 &&
            !isStrictlyTerminal(config.status) &&
            staleTasks.length === 0 && (
              <li className="px-4 py-3 text-[12px] text-[var(--color-muted,#6b7280)]">
                Nothing ready to launch. Pipeline is mid-phase or finished.
              </li>
            )}
        </ul>
      )}

      {/* State-conditional footer banners */}
      {config.status === "failed" && failedTasks.length > 0 && (
        <FooterBanner
          tone="error"
          icon={<XCircle size={14} />}
          testId={`master-card-failed-${config.runId}`}
          title="Pipeline failed"
        >
          <div className="flex flex-col gap-2">
            {failedTasks.map((pt) => (
              <RecoverSnippet
                key={pt.phaseTaskId}
                phaseTaskId={pt.phaseTaskId}
                forceStatus={null}
              />
            ))}
          </div>
        </FooterBanner>
      )}

      {config.status === "needs_validation" && nonTerminalTasks.length > 0 && (
        <FooterBanner
          tone="warn"
          icon={<AlertTriangle size={14} />}
          testId={`master-card-needs-validation-${config.runId}`}
          title="Pipeline needs validation"
        >
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-[var(--color-muted,#6b7280)]">
              Deploy succeeded but {nonTerminalTasks.length} task
              {nonTerminalTasks.length === 1 ? " is" : "s are"} not in a
              terminal state. Mark them as skipped or recover them:
            </p>
            {nonTerminalTasks.map((pt) => (
              <RecoverSnippet
                key={pt.phaseTaskId}
                phaseTaskId={pt.phaseTaskId}
                forceStatus="skipped"
              />
            ))}
          </div>
        </FooterBanner>
      )}

      {config.status === "complete" && (
        <FooterBanner
          tone="success"
          icon={<CheckCircle2 size={14} />}
          testId={`master-card-complete-${config.runId}`}
          title="Pipeline complete"
        >
          <DeployArtifactsList tasks={config.phase_tasks} />
        </FooterBanner>
      )}

      {config.status === "in_progress" && staleTasks.length > 0 && (
        <FooterBanner
          tone="warn"
          icon={<AlertTriangle size={14} />}
          testId={`master-card-stale-${config.runId}`}
          title="Possibly stale"
        >
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-[var(--color-muted,#6b7280)]">
              {staleTasks.length} task{staleTasks.length === 1 ? "" : "s"} have
              been in_progress for over 1 hour with no run-config updates.
              Recover if they're not actually running:
            </p>
            {staleTasks.map((pt) => (
              <RecoverSnippet
                key={pt.phaseTaskId}
                phaseTaskId={pt.phaseTaskId}
                forceStatus="failed"
              />
            ))}
          </div>
        </FooterBanner>
      )}

      {error && (
        <div
          data-testid={`master-card-error-${config.runId}`}
          className="border-t border-[var(--color-border,#e0dbd4)] bg-[#fee2e2] px-4 py-2 text-[12px] text-[#991b1b]"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------

function isStrictlyTerminal(s: RunStatus): boolean {
  return s === "complete" || s === "failed";
}

function detectStaleTasks(config: RunConfigV2): PhaseTask[] {
  const now = Date.now();
  const updatedAtMs = config.updated_at
    ? Date.parse(config.updated_at)
    : Date.parse(config.created_at);
  // If updated_at advanced within the last hour, no task is "stale" relative
  // to the config — orchestrator is alive. Stale tasks only matter when the
  // whole run has been quiet AND a phase_task started over an hour ago.
  if (Number.isFinite(updatedAtMs) && now - updatedAtMs < STALE_IN_PROGRESS_MS) {
    return [];
  }
  return config.phase_tasks.filter((pt) => {
    if (pt.status !== "in_progress") return false;
    const startedAt = pt.startedAt ?? pt.claimAttemptedAt ?? null;
    if (!startedAt) return false;
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) return false;
    return now - startedAtMs > STALE_IN_PROGRESS_MS;
  });
}

function reasonToMessage(reason: string, detail?: string): string {
  switch (reason) {
    case "no_run_config":
      return `No run-config available (${detail ?? "unknown"}). Refresh and retry.`;
    case "phase_task_not_found":
      return "Phase task no longer exists in run-config.";
    case "phase_task_not_actionable":
      return `Phase task is no longer awaiting launch (now: ${detail ?? "?"}).`;
    case "phase_task_prereq_not_met":
      return "Prerequisites for this phase task are not yet completed.";
    case "launch_failed":
      return `Launch failed: ${detail ?? "unknown server error"}.`;
    default:
      return `Continuation failed: ${reason}.`;
  }
}

// ---------- presentational sub-components ----------

function RunStatusBadge({ status }: { status: RunStatus }) {
  const palette = RUN_STATUS_PALETTE[status];
  return (
    <span
      data-testid={`master-card-run-status-${status}`}
      className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const RUN_STATUS_PALETTE: Record<RunStatus, { bg: string; fg: string }> = {
  in_progress: { bg: "#dbeafe", fg: "#1e40af" },
  complete: { bg: "#d1fae5", fg: "#065f46" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
  needs_validation: { bg: "#fef3c7", fg: "#78350f" },
};

function PhaseTaskBadge({ status }: { status: PhaseTaskStatus }) {
  const palette = PHASE_TASK_STATUS_PALETTE[status];
  return (
    <span
      className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

const PHASE_TASK_STATUS_PALETTE: Record<PhaseTaskStatus, { bg: string; fg: string }> = {
  backlog: { bg: "#ede8e1", fg: "#6b7280" },
  awaiting_launch: { bg: "#fef3c7", fg: "#78350f" },
  in_progress: { bg: "#dbeafe", fg: "#1e40af" },
  done: { bg: "#d1fae5", fg: "#065f46" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
  skipped: { bg: "#e5e7eb", fg: "#374151" },
};

const PHASE_DOT_COLOR: Record<string, string> = {
  project: "#6366f1",
  design: "#ec4899",
  plan: "#8b5cf6",
  build: "#059669",
  test: "#0ea5e9",
  security: "#dc2626",
  changelog: "#f59e0b",
  deploy: "#1e40af",
};

function PhaseDot({ phase }: { phase: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
      style={{ background: PHASE_DOT_COLOR[phase] ?? "#9ca3af" }}
    />
  );
}

function Chip({
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { children: React.ReactNode }) {
  return (
    <span
      className="rounded-[var(--radius-button,8px)] bg-[var(--color-muted-bg,#ede8e1)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted,#6b7280)]"
      {...rest}
    >
      {children}
    </span>
  );
}

interface FooterBannerProps {
  tone: "error" | "warn" | "success";
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}

function FooterBanner({ tone, icon, title, testId, children }: FooterBannerProps) {
  const palette =
    tone === "error"
      ? { bg: "#fee2e2", fg: "#991b1b" }
      : tone === "warn"
        ? { bg: "#fef3c7", fg: "#78350f" }
        : { bg: "#d1fae5", fg: "#065f46" };
  return (
    <div
      data-testid={testId}
      className="border-t border-[var(--color-border,#e0dbd4)] px-4 py-3 text-[12px]"
      style={{ background: palette.bg, color: palette.fg }}
    >
      <div className="mb-2 flex items-center gap-1.5 font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function RecoverSnippet({
  phaseTaskId,
  forceStatus,
}: {
  phaseTaskId: string;
  forceStatus: "skipped" | "failed" | null;
}) {
  const args = [
    "uv run plugins/shipwright-run/scripts/lib/orchestrator.py",
    "recover-phase-task",
    `--phase-task-id ${phaseTaskId}`,
  ];
  if (forceStatus) {
    args.push(`--force-status ${forceStatus}`);
  }
  const cmd = args.join(" ");
  return (
    <CopySnippet
      data-testid={`recover-snippet-${phaseTaskId}`}
      command={cmd}
      label={`Recover ${phaseTaskId}`}
    />
  );
}

function DeployArtifactsList({ tasks }: { tasks: PhaseTask[] }) {
  const deploy = tasks.find((t) => t.phase === "deploy" && t.status === "done");
  const artifacts = deploy?.result?.artifacts ?? [];
  if (artifacts.length === 0) {
    return (
      <p className="text-[12px] text-[var(--color-muted,#6b7280)]">
        Deploy task is done. (No artifacts reported.)
      </p>
    );
  }
  return (
    <ul className="list-inside list-disc text-[12px]">
      {artifacts.map((a) => (
        <li key={a} className="font-mono">{a}</li>
      ))}
    </ul>
  );
}
