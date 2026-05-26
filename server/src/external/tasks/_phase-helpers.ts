/*
 * external/tasks/_phase-helpers.ts — phase-task shape validation +
 * project-bound phase resolution. Extracted from routes.ts during C2.
 */

import { loadActionsForProject } from "../../core/project-actions-loader.js";
import {
  PHASE_TASK_ID_PATTERN,
  RUN_ID_PATTERN,
  SESSION_UUID_PATTERN,
} from "../../types/run-config-v2.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

/**
 * iterate-2026-05-18-edit-task-dialog — validate a phase id against a
 * project's actions catalog. Mirrors the inline POST /tasks phase
 * branch; used by PATCH /tasks/:id when the Edit Task dialog changes a
 * never-started task's phase. Returns the resolved id + label, or a
 * structured error body for the route to emit with status 400.
 */
export function validatePhaseForProject(
  rawPhase: string,
  projectId: string,
  getProjectById: ((id: string) => ExternalRouteProjectView | undefined) | undefined,
):
  | { phase: string; phaseLabel: string }
  | { error: Record<string, unknown> } {
  const project = projectId ? getProjectById?.(projectId) : undefined;
  if (!project) {
    return {
      error: {
        error: "phase_requires_project",
        detail:
          "Phase cannot be validated without a real project — " +
          "unassigned tasks have no actions catalog.",
      },
    };
  }
  const loaded = loadActionsForProject(project.path || "");
  const match = loaded.actions.phases.find((p) => p.id === rawPhase);
  if (!match) {
    return {
      error: {
        error: "invalid_phase",
        detail: `Phase '${rawPhase}' is not in this project's actions catalog.`,
        allowed: loaded.actions.phases.map((p) => p.id),
      },
    };
  }
  return { phase: match.id, phaseLabel: match.label };
}

/**
 * iterate/multi-session-run-orchestrator-v2 — Validates phase-task fields
 * on the create-task body. Returns either resolved fields or a structured
 * error tuple. Pure shape-check; cross-checks against the run-config
 * happen in the launch route, which is the security boundary.
 *
 * Plan A6.5: shape-validate every field; the route enforces idempotency
 * via store.findByPhaseTaskId().
 */
export type PhaseTaskCreateFields = {
  phaseTaskId?: string;
  runId?: string;
  sessionUuid?: string;
  parentRunMaster?: boolean;
};

export function resolvePhaseTaskCreateFields(
  body: Record<string, unknown>,
):
  | PhaseTaskCreateFields
  | { error: { error: string; detail?: string }; status: 400 } {
  const out: PhaseTaskCreateFields = {};
  const phaseTaskId = body.phaseTaskId;
  const runId = body.runId;
  const sessionUuid = body.sessionUuid;
  const parentRunMaster = body.parentRunMaster;

  if (
    phaseTaskId === undefined &&
    runId === undefined &&
    sessionUuid === undefined &&
    parentRunMaster === undefined
  ) {
    return out;
  }

  if (phaseTaskId !== undefined) {
    if (typeof phaseTaskId !== "string" || !PHASE_TASK_ID_PATTERN.test(phaseTaskId)) {
      return {
        error: {
          error: "invalid_phase_task_id",
          detail: "phaseTaskId must match /^ptk-[0-9a-f]{4,}$/",
        },
        status: 400,
      };
    }
    out.phaseTaskId = phaseTaskId;
  }
  if (runId !== undefined) {
    if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
      return {
        error: {
          error: "invalid_run_id",
          detail: "runId must match /^run-[0-9a-f]{8}$/",
        },
        status: 400,
      };
    }
    out.runId = runId;
  }
  if (sessionUuid !== undefined) {
    if (
      typeof sessionUuid !== "string" ||
      !SESSION_UUID_PATTERN.test(sessionUuid)
    ) {
      return {
        error: {
          error: "invalid_session_uuid",
          detail: "sessionUuid must be a valid uuid",
        },
        status: 400,
      };
    }
    out.sessionUuid = sessionUuid;
  }
  if (parentRunMaster !== undefined) {
    if (typeof parentRunMaster !== "boolean") {
      return {
        error: {
          error: "invalid_parent_run_master",
          detail: "parentRunMaster must be boolean",
        },
        status: 400,
      };
    }
    out.parentRunMaster = parentRunMaster;
  }
  return out;
}
