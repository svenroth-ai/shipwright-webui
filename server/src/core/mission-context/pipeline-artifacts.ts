/*
 * core/mission-context/pipeline-artifacts.ts — NATIVE artifacts for a pipeline
 * phase task (CONTRACT §4 scenario 3, §10 Slice 3).
 *
 * S1 left this scenario on "today's behavior". This module replaces that: a
 * phase task now resolves from run-config v2 `phase_tasks[]`, its own source of
 * record, rather than borrowing the iterate rail.
 *
 * THE conflation rule. A run has MANY phase tasks and, once splits exist, many
 * for the SAME phase. Resolution is therefore an EXACT `phaseTaskId` match and
 * nothing else — never the phase name, never the session uuid. Matching loosely
 * would attribute one split's work to another, which is worse than showing
 * nothing because it is silently wrong.
 *
 * WHAT IS DELIBERATELY ABSENT, and why (PROBE, S3, against this repo's real
 * data): there is no per-phase requirement or commit source. `phase_completed`
 * events carry `phase`/`commits`/`description`/`detail` and NO `affected_frs`
 * (all 3 real records enumerated); run-config `phase_tasks[]` has no FR field
 * (schema + the real orchestrator fixture both enumerated). So this module emits
 * no Requirement and no Commit for a pipeline rather than inventing a join whose
 * output it cannot demonstrate. The FR table lives in the adopted spec, which IS
 * linked — a real path, checked to exist before it becomes a link.
 *
 * `result.artifacts[]` are shown as TEXT, never as links. The producer records
 * them as bare relative strings with no documented root, so a link built from
 * them would be a guess — and a guess that resolves to nothing is exactly the
 * dead link AC3 forbids.
 */

import type { PhaseArtifact, SpecArtifact } from "./types.js";

/**
 * The phase-task facts the resolver is handed. A narrowed, plain-data mirror of
 * run-config v2's `PhaseTask` — the resolver never sees the whole config.
 */
export interface PhaseTaskFacts {
  phaseTaskId: string;
  phase: string;
  splitId: string | null;
  status: string;
  slashCommand: string | null;
  title: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
  executionCount: number | null;
  errors: string[];
  outputs: string[];
}

/**
 * Why the three failure shapes are distinct, and must stay distinct:
 *   - `unavailable`     — the run-config could not be read. We do not know.
 *   - `task_not_found`  — the config read FINE and does not contain this task.
 *                         That is an integrity fault (the task points at a phase
 *                         task its own run-config does not have), not an absence.
 *   - `ok`              — resolved.
 * Folding the first two into "nothing here" is the failure this campaign has
 * now made three times; it does not get to happen a fourth.
 */
export type PipelineFact =
  | { status: "ok"; runId: string; task: PhaseTaskFacts }
  | { status: "task_not_found"; runId: string }
  | { status: "unavailable" };

/** Plain-language phase name for a non-expert reader. */
function phaseWord(phase: string): string {
  const words: Record<string, string> = {
    project: "Project setup",
    design: "Design",
    plan: "Planning",
    build: "Build",
    test: "Test",
    security: "Security review",
    changelog: "Changelog",
    deploy: "Deploy",
  };
  return words[phase] ?? phase;
}

/** Plain-language status, never the raw enum. */
function statusWord(status: string): string {
  switch (status) {
    case "done":
      return "finished";
    case "in_progress":
      return "running now";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "awaiting_launch":
      return "waiting to start";
    case "backlog":
      return "not started";
    default:
      return status;
  }
}

function phaseSummary(t: PhaseTaskFacts): string {
  const scope = t.splitId ? ` for ${t.splitId}` : "";
  const lead = `${phaseWord(t.phase)}${scope} — ${statusWord(t.status)}.`;
  if (t.status === "failed" && t.errors.length > 0) {
    return `${lead} It reported ${t.errors.length === 1 ? "an error" : `${t.errors.length} errors`}.`;
  }
  if (t.description) return `${lead} ${t.description}`;
  return lead;
}

export function buildPhaseArtifact(fact: PipelineFact): PhaseArtifact {
  const label = "Phase";

  if (fact.status === "unavailable") {
    return {
      kind: "phase",
      label,
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "This run's configuration could not be read, so its phase details are unavailable.",
      detail: null,
    };
  }

  if (fact.status === "task_not_found") {
    // The config READ fine and this task is not in it. Say so — do not let an
    // integrity fault render as "this phase simply has nothing yet".
    return {
      kind: "phase",
      label,
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "This task points at a pipeline step that its run no longer lists.",
      detail: null,
    };
  }

  const t = fact.task;
  return {
    kind: "phase",
    label,
    state: "available",
    summary: phaseSummary(t),
    receipt: t.splitId ? `${phaseWord(t.phase)} · ${t.splitId}` : phaseWord(t.phase),
    detail: {
      type: "phase",
      runId: fact.runId,
      phase: t.phase,
      splitId: t.splitId,
      status: t.status,
      slashCommand: t.slashCommand,
      title: t.title,
      description: t.description,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      executionCount: t.executionCount,
      errors: t.errors,
      outputs: t.outputs,
    },
  };
}

/**
 * The pipeline's Spec artifact: the project's ADOPTED specification, which is
 * also where its FR table lives — hence the combined label.
 *
 * `documentId` is minted by the caller ONLY when the file was actually resolved
 * under a validated read-root, so this never produces a link to nothing.
 */
export function buildPipelineSpecArtifact(input: {
  documentId: string | null;
  title: string | null;
  denied: boolean;
}): SpecArtifact {
  if (input.documentId && input.title) {
    return {
      kind: "spec",
      label: "Spec & requirements",
      state: "available",
      summary:
        "The project specification this run builds to, including the numbered requirements list.",
      receipt: input.title,
      detail: { type: "document", documentId: input.documentId, title: input.title },
    };
  }

  if (input.denied) {
    return {
      kind: "spec",
      label: "Spec & requirements",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "The specification could not be read safely.",
      detail: null,
    };
  }

  // The project has no adopted spec yet. A genuine, honest absence.
  return {
    kind: "spec",
    label: "Spec & requirements",
    state: "not_yet_created",
    summary: null,
    receipt: null,
    detail: null,
  };
}
