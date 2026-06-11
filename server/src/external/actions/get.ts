/*
 * external/actions/get.ts — GET /api/external/projects/:projectId/actions.
 *
 * Resolved actions schema for the project. Falls back to the bundled
 * default when .shipwright-webui/actions.json is absent; returns diagnostics in-band
 * when the user file exists but is malformed (O24 chip). Validates every
 * command_template via the substitute dry-run; unknown placeholder → 400.
 */

import type { Hono } from "hono";

import { loadActionsForProject } from "../../core/project-actions-loader.js";
import {
  validateActionsSchema,
  type SchemaError,
} from "../../core/actions-schema-validator.js";
import type { PreviewProfile } from "../../core/preview-session-manager.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { dryRunTemplate } from "./_helpers.js";

export function registerActionsGet(
  app: Hono,
  deps: {
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
    loadProfile: (profileName: string) => PreviewProfile | null;
  },
): void {
  const { getProjectById, loadProfile } = deps;

  app.get("/api/external/projects/:projectId/actions", (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }

    const loaded = loadActionsForProject(project.path || "");
    const actions = loaded.actions;

    // Structural validation (5 O24 cases).
    const schemaErrors: SchemaError[] = validateActionsSchema(actions);
    if (schemaErrors.length > 0) {
      const first = schemaErrors[0];
      return c.json(
        {
          error: first.code,
          errors: schemaErrors,
          projectId,
        },
        400,
      );
    }

    // Placeholder-level dry-run validation per action template.
    for (const a of actions.actions) {
      if (!a.command_template) continue;
      const phaseIds = actions.phases.map((p) => p.id);
      try {
        const errCandidate = dryRunTemplate(
          a.command_template,
          a.id,
          phaseIds,
          a.slash_command,
        );
        if (errCandidate) {
          return c.json(
            {
              error: "invalid_placeholder",
              placeholder: errCandidate.placeholder,
              actionId: errCandidate.actionId,
              template: errCandidate.template,
            },
            400,
          );
        }
      } catch {
        // Defense-in-depth: a crashing template validator should fail
        // the route rather than expose the raw stack trace.
        return c.json(
          { error: "template_validation_failed", actionId: a.id },
          500,
        );
      }
    }

    // Resolve preview.enabled per plan.md § 2.1 precedence:
    //   Step 1 — profile.stack.frontend present AND dev_server.command
    //            present → true unless explicitly disabled below.
    //   Step 2 — actions.preview.enabled:
    //            "auto"  → follow Step 1.
    //            true    → only honored if Step 1 also allowed it.
    //            false   → force off regardless.
    const profile = project.profile
      ? (loadProfile(project.profile) as
          | (PreviewProfile & { stack?: { frontend?: unknown } })
          | null)
      : null;
    const profileAllowsPreview =
      Boolean(profile?.stack?.frontend) &&
      Boolean(profile?.dev_server?.command);
    const actionsPref = actions.preview?.enabled;
    let previewEnabled: boolean;
    if (actionsPref === false) {
      previewEnabled = false;
    } else if (actionsPref === true) {
      previewEnabled = profileAllowsPreview;
    } else {
      previewEnabled = profileAllowsPreview;
    }

    return c.json({
      actions: actions.actions,
      phases: actions.phases,
      defaults: actions.defaults,
      preview: {
        enabled: previewEnabled,
        command: profile?.dev_server?.command ?? null,
        port: profile?.dev_server?.port ?? null,
        ready_path: profile?.dev_server?.ready_path ?? null,
        ready_timeout_seconds: profile?.dev_server?.ready_timeout_seconds ?? null,
      },
      diagnostics: loaded.diagnostics,
      // FR-01.27 — Settings UI uses this to render the source-state badge
      // (Custom / Bundled / Malformed). True iff the loader read
      // `<project.path>/.shipwright-webui/actions.json` successfully.
      fromUser: loaded.fromUser,
    });
  });
}
