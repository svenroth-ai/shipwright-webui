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

/**
 * Pipeline execution mode (schema field `run_config.mode`).
 *
 *  - `single_session` — the /shipwright-run master drives every phase via a
 *    phase-runner subagent in ONE conversation; the sole supported FRESH-write
 *    mode (SS8, 2026-07-08), and the ONLY value the schema enum accepts. Runs
 *    on every surface.
 *  - `multi_session`  — each phase is its own external UUID-bound Claude
 *    session (pre-SS1 behaviour). RETIRED — not a valid schema value for a
 *    fresh write, kept here only so a pre-SS1 config still carrying this
 *    literal on disk still parses (`isRunMode`/`parseRunMode` read-compat).
 *
 * `mode` is OPTIONAL on disk (NOT in the schema's `required`), and the schema
 * carries NO `default` ON PURPOSE — absence is MEANINGFUL there ("not a
 * drivable run"), so nothing may silently reinterpret a mode-less legacy
 * config as drivable. `resolveRunMode()` still needs a concrete return value
 * for that case; `DEFAULT_RUN_MODE` is a plain fallback sentinel for that
 * function only, never a disk-valid `RunMode` literal — see `RUN_MODES` /
 * `isRunMode`, which deliberately do NOT include it.
 */
export type RunMode = "multi_session" | "single_session";

export const RUN_MODES: readonly RunMode[] = [
  "multi_session",
  "single_session",
] as const;

/**
 * Sentinel for "absent or unrecognised `mode`" — i.e. NOT a drivable run.
 * Mirrors the framework's own sentinel for this exact situation,
 * `gate_policy.INERT_MODE` (shared/scripts/lib/gate_policy.py, introduced in
 * the same 2026-07-14 commit that removed `multi_session`'s engine) —
 * `multi_session` used to play this role and was replaced there precisely
 * because it is a retired pipeline mode, not a "no pipeline" marker.
 * Deliberately NOT a member of `RunMode`/`RUN_MODES`: it is never written to
 * disk and `isRunMode("standalone")` is false, same as the framework's own
 * `mode == "single_session"` explicit-literal-only activation rule.
 */
export const DEFAULT_RUN_MODE = "standalone" as const;

export type ResolvedRunMode = RunMode | typeof DEFAULT_RUN_MODE;

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
  /** OPTIONAL; absent → DEFAULT_RUN_MODE via resolveRunMode(). See RunMode. */
  mode?: RunMode;
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

export function isRunMode(v: unknown): v is RunMode {
  return v === "multi_session" || v === "single_session";
}

/**
 * Resolve a run's execution mode. Present + valid → itself (incl. the
 * retired `multi_session` literal, read-compat only). Absent OR unrecognised
 * → `DEFAULT_RUN_MODE` ("standalone" — not a drivable run). Stays defensive
 * even though the reader already drops unrecognised values.
 */
export function resolveRunMode(config: { mode?: RunMode }): ResolvedRunMode {
  return isRunMode(config.mode) ? config.mode : DEFAULT_RUN_MODE;
}
