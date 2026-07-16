/*
 * IntentWizard DATA CONTRACT (A09a, FR-01.52).
 *
 * A08 built the wizard UI as a STUB; A09a wires the New + Adopt doors to the
 * REAL create → launch path. The flow's #1 silent break is a launch WITHOUT an
 * `actionId`: the server then falls through to the legacy `buildCopyCommands()`
 * path and the terminal auto-executes a bare `claude` with an EMPTY prompt
 * (Codex rebuild gap #3). This module is that written-down contract:
 *   (a) the per-door REQUEST body, (b) the CREATE response (project/task/session
 *   uuid), (c) the LAUNCH state (every lifecycle + terminal state). The pure
 * builders turn a request into the exact create/task/launch payloads and
 * GUARANTEE `actionId` + a brief on every New/Adopt launch (AC3). Tests import
 * these types + builders, never re-declaring shapes inline (AC4).
 *
 * Grade is DEFINED here (request + report state) but NOT implemented in A09a —
 * it stays on A08's stub; A09b adds the real server route on this same contract.
 */

import type { NewAnswers, WizardDoor } from "./types";

export type { WizardDoor };

/* (c) LAUNCH STATE — the lifecycle every door shares. A09a PRODUCES idle →
 * creating → created → launching → running (then navigates to Mission), or
 * launch-failed. The two post-navigation TERMINAL states (jsonl-missing /
 * permission-denied) are DEFINED for A17's transcript state machine to detect
 * after the hand-off — A09a never produces them (it has already navigated). */
export type WizardLaunchState =
  | "idle"
  | "creating"
  | "created"
  | "launching"
  | "running"
  | "launch-failed"
  | "jsonl-missing"
  | "permission-denied";

/** Terminal (non-recoverable-in-place) states — a UI may offer retry/relaunch. */
export const TERMINAL_LAUNCH_STATES: readonly WizardLaunchState[] = [
  "launch-failed",
  "jsonl-missing",
  "permission-denied",
];

export function isTerminalLaunchState(s: WizardLaunchState): boolean {
  return TERMINAL_LAUNCH_STATES.includes(s);
}

/* ────────────────────────────────────────────────────────────────────────────
 * StackProfile / EnvVars mapping (New door).
 *
 * `remember = "Yes"` → the persistence stack (`supabase-nextjs`, needs a free
 * account); anything else → `vite-hono`, the zero-signup fully-local default.
 * Supabase env vars are only relevant when the app both runs on the web AND
 * remembers things — otherwise there is nothing to deploy secrets for (AC1).
 * ──────────────────────────────────────────────────────────────────────────── */
export const PROFILE_PERSISTENT = "supabase-nextjs";
export const PROFILE_LOCAL = "vite-hono";
/** The webui project profile for an adopt: the real stack is detected by the
 *  plugin, so we register `custom` and let adopt fill it in (never guess). */
export const PROFILE_ADOPT = "custom";

export interface StackProfileResolution {
  profile: string;
  note: string;
  /** True ONLY for "web + remember" — the sole case Supabase env vars matter. */
  envVarsRequired: boolean;
}

export function resolveStackProfile(answers: NewAnswers): StackProfileResolution {
  const remembers = answers.remember === "Yes";
  const onWeb = answers.where === "On the web";
  if (remembers) {
    return {
      profile: PROFILE_PERSISTENT,
      note: "needs a free Supabase account",
      envVarsRequired: onWeb,
    };
  }
  return {
    profile: PROFILE_LOCAL,
    note: "runs fully local · zero-signup default · upgradeable later",
    envVarsRequired: false,
  };
}

/* (a) REQUEST bodies — what the wizard assembles per door. */

/** New → creates a project + task and launches `/shipwright-run:run` (via the
 *  bundled `new-pipeline` action) with the brief pre-loaded. */
export interface NewLaunchRequest {
  door: "new";
  name: string;
  path: string;
  profile: string;
  brief: string;
  envVarsRequired: boolean;
  actionId: "new-pipeline";
}

/** Adopt → registers the project against the existing repo and launches
 *  `/shipwright-adopt` (via `new-task` + the one-shot `adopt` phase). The repo
 *  path is both the project cwd AND the brief handed to the plugin. */
export interface AdoptLaunchRequest {
  door: "adopt";
  name: string;
  path: string;
  profile: string;
  brief: string;
  actionId: "new-task";
  phase: "adopt";
  phaseLabel: "Adopt";
}

/** Grade → read-only; NO project registration, NO task launch. Implemented by
 *  A09b as a server route; the shape lives here so A09b consumes ONE contract.
 *  `actionId` is deliberately `null`: Grade is not a task launch, so it never
 *  travels the create→launch path (and can never fall through to an empty
 *  prompt). */
export interface GradeRequest {
  door: "grade";
  target: string;
  isRemote: boolean;
  actionId: null;
}

export type WizardLaunchRequest = NewLaunchRequest | AdoptLaunchRequest;

/** Grade's report lifecycle (A09b) — one state per honest server outcome
 *  (grade-runner.GradeStatus); NO state fabricates a grade. */
export type GradeReportState =
  | "idle"
  | "grading"
  | "report-ready"
  | "shape-unrecognised"
  | "grade-failed"
  | "engine-unavailable";

/* (b) CREATE response. */
export interface WizardCreateResponse {
  projectId: string;
  taskId: string;
  sessionUuid: string;
}

/* Concrete API payloads derived from a request. */
export interface WizardCreateProjectPayload {
  name: string;
  path: string;
  profile: string;
  settings?: { envVars: Record<string, string> };
}

export interface WizardCreateTaskPayload {
  title: string;
  cwd: string;
  projectId: string;
  /** AC3 — ALWAYS present; without it the task resolves to the legacy path. */
  actionId: string;
  /** AC3 — the brief; ALWAYS present so the terminal prompt is never empty. */
  description: string;
  phase?: string;
}

export interface WizardLaunchPayload {
  /** AC3 — ALWAYS present. */
  actionId: string;
  /** AC3 — the brief; ALWAYS present. */
  description: string;
  phase?: string;
  phaseLabel?: string;
}

/* Builders — request assembly. */

/** Slug a free-text brief into a filesystem-safe project name. */
export function deriveNewProjectName(brief: string): string {
  const slug = brief
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "new-project";
}

/** Last path/URL segment → a human name for an adopt project. */
export function deriveAdoptProjectName(path: string): string {
  const cleaned = path.trim().replace(/[\\/]+$/g, "");
  const seg = cleaned.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return seg || "adopted-repo";
}

/**
 * Compose the full wizard intake into ONE brief line for `/shipwright-run` so
 * its brief-intake (B4/B5) doesn't re-ask what the wizard already answered
 * (AC1 — "no wizard question asked twice"). The idea leads; the four answers +
 * the derived stack profile follow as explicit intake context. Single physical
 * line (the server substituter flattens newlines, but we keep it clean here).
 */
export function composeNewBrief(
  answers: NewAnswers,
  resolution: StackProfileResolution,
): string {
  const idea = answers.brief?.trim() || "My idea";
  const parts: string[] = [];
  if (answers.who) parts.push(`Users: ${answers.who}`);
  parts.push(`Saves data: ${answers.remember ?? "Not sure yet"}`);
  if (answers.where) parts.push(`Runs: ${answers.where}`);
  parts.push(`Stack profile: ${resolution.profile}`);
  if (resolution.envVarsRequired) {
    parts.push("Supabase env vars will be needed at the Deploy step (not before)");
  }
  return `${idea} (Intake — ${parts.join("; ")}.)`;
}

/**
 * New door: answers + a name + a target folder → the launch request. The brief
 * is guaranteed non-empty (the reducer defaults a blank brief to "My idea"), but
 * we harden it here too so a launch can never hand an empty prompt to
 * `/shipwright-run` (AC3). The launch brief carries the full intake (AC1).
 */
export function buildNewLaunchRequest(
  answers: NewAnswers,
  target: { name: string; path: string },
): NewLaunchRequest {
  const resolution = resolveStackProfile(answers);
  const idea = answers.brief?.trim() || "My idea";
  const name = target.name.trim() || deriveNewProjectName(idea);
  return {
    door: "new",
    name,
    path: target.path.trim(),
    profile: resolution.profile,
    brief: composeNewBrief(answers, resolution),
    envVarsRequired: resolution.envVarsRequired,
    actionId: "new-pipeline",
  };
}

/**
 * Adopt door: the picked repo path → the launch request. The path is the cwd
 * AND the brief handed to `/shipwright-adopt` (the plugin reads the repo it runs
 * in; naming it in the prompt keeps the terminal prompt honest + non-empty).
 */
export function buildAdoptLaunchRequest(path: string): AdoptLaunchRequest {
  const trimmed = path.trim();
  return {
    door: "adopt",
    name: deriveAdoptProjectName(trimmed),
    path: trimmed,
    profile: PROFILE_ADOPT,
    brief: `Adopt the repository at ${trimmed} into Shipwright`,
    actionId: "new-task",
    phase: "adopt",
    phaseLabel: "Adopt",
  };
}

/* Builders — request → API payloads (AC3: actionId + brief on every launch). */

export function toCreateProjectPayload(
  req: WizardLaunchRequest,
): WizardCreateProjectPayload {
  const payload: WizardCreateProjectPayload = {
    name: req.name,
    path: req.path,
    profile: req.profile,
  };
  return payload;
}

export function toCreateTaskPayload(
  req: WizardLaunchRequest,
  projectId: string,
  cwd: string,
): WizardCreateTaskPayload {
  const base: WizardCreateTaskPayload = {
    title: req.name,
    cwd,
    projectId,
    actionId: req.actionId,
    description: req.brief,
  };
  if (req.door === "adopt") base.phase = req.phase;
  return base;
}

export function toLaunchPayload(req: WizardLaunchRequest): WizardLaunchPayload {
  const base: WizardLaunchPayload = {
    actionId: req.actionId,
    description: req.brief,
  };
  if (req.door === "adopt") {
    base.phase = req.phase;
    base.phaseLabel = req.phaseLabel;
  }
  return base;
}
