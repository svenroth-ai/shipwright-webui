/*
 * external/tasks/create.ts — POST /api/external/tasks.
 *
 * iterate-20260423-chat-livetest-2 AC-B + iterate-2026-05-14 lead-foundation
 * + iterate-2026-05-18-edit-task-dialog + multi-session-run-orchestrator-v2
 * — see inline comments for the contract for each optional field.
 */

import type { Hono } from "hono";

import { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import { loadActionsForProject } from "../../core/project-actions-loader.js";
import { normalizeFsPath } from "../../core/normalize-fs-path.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import {
  normalizeDescription,
  readLeadCreateFields,
  validateProjectIdOrError,
  withLiveSession,
} from "../_shared/helpers.js";
import { resolvePhaseTaskCreateFields } from "./_phase-helpers.js";

export function registerTasksCreate(
  app: Hono,
  deps: {
    store: SdkSessionsStore;
    ptyManager: { get(taskId: string): unknown };
    getKnownProjectIds?: () => Set<string>;
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  },
): void {
  const { store, ptyManager, getKnownProjectIds, getProjectById } = deps;

  app.post("/api/external/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : "Untitled task";
    // normalizeFsPath strips a paste-artifact surrounding quote pair (a
    // space-containing path copied from a shell context) before it reaches
    // core/launcher.ts, which would otherwise shell-escape the literal quotes
    // into a broken `cd ''\''…'\'''` prefix. Empty / quotes-only → process.cwd().
    const rawCwd =
      typeof body.cwd === "string" ? normalizeFsPath(body.cwd) : "";
    const cwd = rawCwd || process.cwd();
    const pluginDirs = Array.isArray(body.pluginDirs)
      ? body.pluginDirs.filter((p: unknown): p is string => typeof p === "string")
      : [];
    // Section 02 (iterate 3) — allow callers to pass an explicit projectId
    // at creation. Defaults to UNASSIGNED_PROJECT_ID via the store. Invalid
    // ids are rejected symmetrically with PATCH so the TaskBoard inline
    // form can't leak a stale project id from a deleted project.
    let projectId: string | undefined;
    if (typeof body.projectId === "string" && body.projectId.trim()) {
      const candidate = body.projectId.trim();
      const validation = validateProjectIdOrError(candidate, getKnownProjectIds);
      if (validation) return c.json(validation, 400);
      projectId = candidate;
    }

    // 2026-04-23 — Phase persisted on CREATION when the project's actions
    // catalog validates the id. Server derives phaseLabel from the
    // catalog entry — client-sent label is intentionally dropped to avoid
    // label drift when the UI caches stale actions.json.
    //
    // Reject (not silently drop) when phase is supplied without a
    // resolvable project — the client has no way to discover which phases
    // are valid without a catalog, so sending phase there is a bug.
    let phase: string | undefined;
    let phaseLabel: string | undefined;
    const rawPhase =
      typeof body.phase === "string" && body.phase.trim()
        ? body.phase.trim()
        : undefined;
    if (rawPhase) {
      if (!projectId) {
        return c.json(
          {
            error: "phase_requires_project",
            detail:
              "Phase cannot be validated without a projectId — " +
              "unassigned tasks have no actions catalog.",
          },
          400,
        );
      }
      const project = getProjectById?.(projectId);
      if (!project) {
        return c.json(
          {
            error: "phase_requires_project",
            detail: `Phase cannot be validated — project '${projectId}' has no resolvable catalog.`,
          },
          400,
        );
      }
      const loaded = loadActionsForProject(project.path || "");
      const match = loaded.actions.phases.find((p) => p.id === rawPhase);
      if (!match) {
        return c.json(
          {
            error: "invalid_phase",
            detail: `Phase '${rawPhase}' is not in this project's actions catalog.`,
            allowed: loaded.actions.phases.map((p) => p.id),
          },
          400,
        );
      }
      phase = match.id;
      phaseLabel = match.label;
    }

    // iterate/multi-session-run-orchestrator-v2 — Phase-task linkage
    // (review O #5/#6 + plan A4/A6.5). When the body carries phase-task
    // metadata, validate the shapes here and reuse an existing
    // non-terminal shadow if one already maps to the same phaseTaskId
    // (idempotency for repeat Continue Pipeline clicks).
    const phaseTaskRefs = resolvePhaseTaskCreateFields(body);
    if ("error" in phaseTaskRefs) {
      return c.json(phaseTaskRefs.error, phaseTaskRefs.status);
    }
    if (phaseTaskRefs.phaseTaskId) {
      const existing = store.findByPhaseTaskId(phaseTaskRefs.phaseTaskId);
      if (existing) {
        return c.json({ task: withLiveSession(existing, ptyManager), reused: true });
      }
    }

    // 2026-05-05 — Save-to-Backlog wiring. Persist the chosen action id at
    // create-time so a later TaskCard "Launch" click can recover the right
    // command_template. Catalog membership is not validated here — the
    // /launch handler already rejects unknown ids (`unknown_action_id` 400).
    const createActionId =
      typeof body.actionId === "string" && body.actionId.trim().length > 0
        ? body.actionId.trim()
        : undefined;

    // iterate-2026-05-14 lead-foundation-task-schema — five user-creatable
    // routing fields land here with soft-drop semantics.
    const leadFields = readLeadCreateFields(body);

    // iterate-2026-05-18-edit-task-dialog — persist the description on
    // create so "Save to Backlog" no longer drops it.
    const descResult = normalizeDescription(body.description);
    if (!descResult.ok) {
      return c.json(
        { error: "invalid_description", detail: descResult.error },
        400,
      );
    }

    const task = store.create({
      title,
      cwd,
      pluginDirs,
      projectId,
      phase,
      phaseLabel,
      actionId: createActionId,
      description: descResult.value,
      sessionUuid: phaseTaskRefs.sessionUuid,
      phaseTaskId: phaseTaskRefs.phaseTaskId,
      runId: phaseTaskRefs.runId,
      parentRunMaster: phaseTaskRefs.parentRunMaster,
      ...leadFields,
    });
    await store.persist();
    return c.json({ task: withLiveSession(task, ptyManager) });
  });
}
