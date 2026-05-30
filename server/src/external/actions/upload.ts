/*
 * external/actions/upload.ts — POST /api/projects/:id/actions-upload.
 *
 * Replaces `<project.path>/.shipwright-webui/actions.json` with a JSON body validated
 * against the actions schema. Iterate iterate-20260430-actions-upload-ui
 * (FR-01.27).
 *
 * Validation pipeline (rejects with 4xx on first failure):
 *   1. Project resolvable + has a filesystem path.
 *   2. Raw body ≤ ACTIONS_UPLOAD_MAX_BYTES.
 *   3. Body parses as JSON.
 *   4. checkContractVersion (fail-soft: warns once, never blocks).
 *   5. validateActionsSchema returns no errors.
 *
 * Atomic write: writeFileSync to a sibling tmp path, then renameSync.
 * Cache: clearActionsCacheForProject() so the next GET /actions reflects
 * the new file.
 *
 * CLAUDE.md DO-NOT regression guard #10: realPathGuard is mandatory on
 * the destination dir before any write.
 */

import type { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import {
  clearActionsCacheForProject,
  type ResolvedActions,
} from "../../core/project-actions-loader.js";
import {
  validateActionsSchema,
  type SchemaError,
} from "../../core/actions-schema-validator.js";
import {
  checkContractVersion,
  ACTIONS_SCHEMA_VERSION,
} from "../../core/contract-version.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { ACTIONS_UPLOAD_MAX_BYTES, dryRunTemplate } from "./_helpers.js";

export function registerActionsUpload(
  app: Hono,
  deps: {
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  },
): void {
  const { getProjectById } = deps;

  app.post("/api/projects/:id/actions-upload", async (c) => {
    const id = c.req.param("id");
    const project = getProjectById?.(id);
    if (!project) {
      return c.json({ error: "project_not_found", projectId: id }, 404);
    }
    if (!project.path) {
      return c.json(
        { error: "project_path_unavailable", projectId: id },
        400,
      );
    }

    // Pre-buffer DoS guard — reject before reading the body when the
    // declared Content-Length already exceeds the cap.
    const declaredLength = Number(c.req.header("content-length") ?? "");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > ACTIONS_UPLOAD_MAX_BYTES
    ) {
      return c.json(
        {
          error: "payload_too_large",
          maxBytes: ACTIONS_UPLOAD_MAX_BYTES,
          size: declaredLength,
        },
        413,
      );
    }

    const raw = await c.req.text();
    if (raw.length > ACTIONS_UPLOAD_MAX_BYTES) {
      return c.json(
        {
          error: "payload_too_large",
          maxBytes: ACTIONS_UPLOAD_MAX_BYTES,
          size: raw.length,
        },
        413,
      );
    }

    let parsed: ResolvedActions;
    try {
      parsed = JSON.parse(raw) as ResolvedActions;
    } catch (err) {
      return c.json(
        { error: "invalid_json", detail: String(err).slice(0, 200) },
        400,
      );
    }

    // Schema validation requires a structured object — guard against
    // null / array / scalar before the validator dereferences fields.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json(
        { error: "invalid_json", detail: "expected JSON object at top level" },
        400,
      );
    }

    // Fail-soft: emits a one-shot warn on console for newer-than-known
    // schemaVersion, but does not block the upload.
    checkContractVersion({
      artefact: ".shipwright-webui/actions.json (upload)",
      path: project.path,
      declared: parsed.schemaVersion,
      knownMax: ACTIONS_SCHEMA_VERSION,
      fieldName: "schemaVersion",
    });

    const errors: SchemaError[] = validateActionsSchema(parsed);
    if (errors.length > 0) {
      return c.json({ error: "schema_validation_failed", errors }, 400);
    }

    // Placeholder dry-run — same check the GET /actions route runs against
    // the loader output.
    const phaseIds = parsed.phases.map((p) => p.id);
    for (const action of parsed.actions) {
      if (!action.command_template) continue;
      const errCandidate = dryRunTemplate(action.command_template, action.id, phaseIds);
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
    }

    const dir = join(project.path, ".shipwright-webui");
    const file = join(dir, "actions.json");
    const tmp = join(dir, `actions.json.tmp-${process.pid}-${Date.now()}`);
    try {
      mkdirSync(dir, { recursive: true });
      const guard = realPathGuard(project.path, dir);
      if (!guard.ok) {
        return c.json(
          { error: "path_unsafe", reason: guard.reason, path: dir },
          400,
        );
      }
      writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      renameSync(tmp, file);
    } catch (err) {
      // Best-effort tmp cleanup — ignore if it is already gone.
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* swallow */
      }
      return c.json(
        {
          error: "upload_write_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }

    clearActionsCacheForProject(project.path);
    return c.json({ path: file, written: true });
  });
}
