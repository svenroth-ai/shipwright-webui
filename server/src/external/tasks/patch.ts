/*
 * external/tasks/patch.ts — PATCH /api/external/tasks/:id.
 *
 * Clear-vs-omit contract: a key PRESENT in the body is an update; an
 * OMITTED key is untouched; `""` / `null` clears a scalar/enum; `[]`
 * clears an array.
 *
 * Lifecycle gate (fail fast, before per-field validation): the four
 * launch-shaping fields (description / phase / priority / complexityHint)
 * freeze once the task has started — see `core/task-editability.ts`.
 *
 * CLAUDE.md rule 6 — concurrent writers serialized by `proper-lockfile`;
 * on lock contention → 409 `sdk-sessions.json is locked, retry`.
 */

import type { Hono } from "hono";

import { isFieldEditable } from "../../core/task-editability.js";
import {
  SdkSessionsStore,
  type ExternalTask,
} from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import {
  normalizeDescription,
  normalizeStringArray,
  normalizeTitle,
  validateProjectIdOrError,
  withLiveSession,
} from "../_shared/helpers.js";
import { validatePhaseForProject } from "./_phase-helpers.js";

const PATCHABLE = [
  "title",
  "projectId",
  "description",
  "phase",
  "priority",
  "complexityHint",
  "domain",
  "tags",
  "blockedBy",
];

export function registerTasksPatch(
  app: Hono,
  deps: {
    store: SdkSessionsStore;
    ptyManager: { get(taskId: string): unknown };
    getKnownProjectIds?: () => Set<string>;
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  },
): void {
  const { store, ptyManager, getKnownProjectIds, getProjectById } = deps;

  app.patch("/api/external/tasks/:id", async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    const present = PATCHABLE.filter((f) => f in body);
    if (present.length === 0) {
      return c.json({ error: "at_least_one_field_required" }, 400);
    }

    // Lifecycle gate.
    const frozenViolations = present.filter((f) => !isFieldEditable(f, task));
    if (frozenViolations.length > 0) {
      return c.json(
        {
          error: "field_not_editable",
          fields: frozenViolations,
          detail:
            "These fields are frozen once the task has started: " +
            `${frozenViolations.join(", ")}.`,
        },
        409,
      );
    }

    const patch: Partial<ExternalTask> = {};

    if ("title" in body) {
      const r = normalizeTitle(body.title);
      if (!r.ok) return c.json({ error: r.error }, 400);
      patch.title = r.value;
    }

    if ("projectId" in body) {
      if (typeof body.projectId !== "string" || body.projectId.trim() === "") {
        return c.json({ error: "projectId cannot be empty" }, 400);
      }
      const candidate = body.projectId.trim();
      const validation = validateProjectIdOrError(candidate, getKnownProjectIds);
      if (validation) return c.json(validation, 400);
      patch.projectId = candidate;
    }

    if ("description" in body) {
      const r = normalizeDescription(body.description);
      if (!r.ok) {
        return c.json({ error: "invalid_description", detail: r.error }, 400);
      }
      patch.description = r.value;
    }

    if ("phase" in body) {
      const raw = body.phase;
      if (raw === "" || raw === null) {
        patch.phase = undefined;
        patch.phaseLabel = undefined;
      } else if (typeof raw === "string" && raw.trim()) {
        const phaseResult = validatePhaseForProject(
          raw.trim(),
          patch.projectId ?? task.projectId,
          getProjectById,
        );
        if ("error" in phaseResult) {
          return c.json(phaseResult.error, 400);
        }
        patch.phase = phaseResult.phase;
        patch.phaseLabel = phaseResult.phaseLabel;
      } else {
        return c.json(
          { error: "invalid_phase", detail: "phase must be a string or empty" },
          400,
        );
      }
    }

    if ("priority" in body) {
      const p = body.priority;
      if (p === "" || p === null) {
        patch.priority = undefined;
      } else if (p === "P0" || p === "P1" || p === "P2" || p === "P3") {
        patch.priority = p;
      } else {
        return c.json(
          {
            error: "invalid_priority",
            detail: "priority must be P0–P3 or empty",
          },
          400,
        );
      }
    }

    if ("complexityHint" in body) {
      const ch = body.complexityHint;
      if (ch === "" || ch === null) {
        patch.complexityHint = undefined;
      } else if (ch === "small" || ch === "medium" || ch === "large") {
        patch.complexityHint = ch;
      } else {
        return c.json(
          {
            error: "invalid_complexity_hint",
            detail:
              "complexityHint must be small | medium | large or empty",
          },
          400,
        );
      }
    }

    if ("domain" in body) {
      const d = body.domain;
      if (d === "" || d === null) {
        patch.domain = undefined;
      } else if (typeof d === "string") {
        const trimmed = d.trim();
        patch.domain = trimmed.length > 0 ? trimmed : undefined;
      } else {
        return c.json(
          { error: "invalid_domain", detail: "domain must be a string" },
          400,
        );
      }
    }

    if ("tags" in body) {
      if (!Array.isArray(body.tags)) {
        return c.json(
          { error: "invalid_tags", detail: "tags must be an array of strings" },
          400,
        );
      }
      patch.tags = normalizeStringArray(body.tags);
    }

    if ("blockedBy" in body) {
      if (!Array.isArray(body.blockedBy)) {
        return c.json(
          {
            error: "invalid_blocked_by",
            detail: "blockedBy must be an array of strings",
          },
          400,
        );
      }
      // Dedup + drop empties + drop self-reference (external review #7).
      patch.blockedBy = normalizeStringArray(body.blockedBy).filter(
        (id) => id !== task.taskId,
      );
    }

    store.patch(task.taskId, patch);
    try {
      await store.persist();
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
        return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
      }
      throw err;
    }
    return c.json({
      task: withLiveSession(store.get(task.taskId), ptyManager),
    });
  });
}
