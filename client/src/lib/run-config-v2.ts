/*
 * Client-side mirror of the framework's `run_config.v2.schema.json`.
 *
 * Source (authoritative): shared/schemas/run_config.v2.schema.json in the
 * sister `shipwright` repo (merged 2026-04-25 as commit 7d402d3). Server
 * mirror lives at `server/src/types/run-config-v2.ts`.
 *
 * Intentional duplication (per CLAUDE.md `conventions.md`): the two sides
 * never import each other; structural divergence is caught by the
 * server-side fixture parity test reading the shared sample.
 *
 * NOTE: this file is types-only — the schema-parity guard runs server-side.
 */

export type RunPhase =
  | "project"
  | "design"
  | "plan"
  | "build"
  | "test"
  | "security"
  | "changelog"
  | "deploy";

export const RUN_PHASES: readonly RunPhase[] = [
  "project",
  "design",
  "plan",
  "build",
  "test",
  "security",
  "changelog",
  "deploy",
] as const;

export type SplitMode = "none" | "per_split" | null;

export type RunStatus = "in_progress" | "complete" | "failed" | "needs_validation";

export type PhaseTaskStatus =
  | "backlog"
  | "awaiting_launch"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped";

export const TERMINAL_PHASE_TASK_STATUSES: readonly PhaseTaskStatus[] = [
  "done",
  "failed",
  "skipped",
] as const;

export interface RunConditions {
  securityEnabled: boolean;
  splitMode: SplitMode;
  aikidoClientIdPresent: boolean;
}

export interface PhaseTaskResult {
  ok?: boolean;
  artifacts?: string[];
  [extra: string]: unknown;
}

export interface PhaseTask {
  phaseTaskId: string;
  phase: RunPhase;
  splitId: string | null;
  sessionUuid: string;
  version: number;
  status: PhaseTaskStatus;
  title: string;
  description?: string;
  slashCommand: string;
  launchCommandHint?: string;
  prerequisites: string[];
  claimedBySessionUuid?: string | null;
  claimAttemptedAt?: string | null;
  executionCount: number;
  createdAt: string;
  awaitingLaunchAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  result?: PhaseTaskResult | null;
  errors?: string[];
}

export interface RunConfigV2 {
  schemaVersion: 2;
  runId: string;
  scope: "full_app" | "extension";
  profile?: string | null;
  autonomy: "guided" | "autonomous";
  deploy_target: string;
  pipeline: RunPhase[];
  runConditions: RunConditions;
  splits_frozen: string[];
  status: RunStatus;
  completed_phase_task_ids: string[];
  phase_tasks: PhaseTask[];
  phase_history?: Record<string, unknown>;
  iterate_history?: unknown[];
  created_at: string;
  updated_at?: string;
  validation_issues?: unknown[];
  validation_notes?: unknown[];
  last_compliance_update?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface RunConfigDiagnostics {
  droppedPhaseTaskIds: string[];
  warnings: string[];
}

export type RunConfigResponse =
  | { status: "missing" }
  | { status: "v1_legacy" }
  | { status: "invalid"; reason: string }
  | {
      status: "ok";
      config: RunConfigV2;
      readyToLaunchTasks: PhaseTask[];
      diagnostics: RunConfigDiagnostics;
    };

export const RUN_ID_PATTERN = /^run-[0-9a-f]{8}$/;
export const PHASE_TASK_ID_PATTERN = /^ptk-[0-9a-f]{4,}$/;

/** "Run-{shortRunId}" with safe fallback to the full runId (review O #15). */
export function formatRunLabel(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) return runId;
  return `Run-${runId.slice(4, 8)}`;
}

export function isTerminalPhaseTaskStatus(s: PhaseTaskStatus): boolean {
  return TERMINAL_PHASE_TASK_STATUSES.includes(s);
}

export function isTerminalRunStatus(s: RunStatus): boolean {
  return s === "complete" || s === "failed";
}
