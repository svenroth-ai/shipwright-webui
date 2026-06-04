/*
 * external/launch/parse-body.ts — parseLaunchBody (extracted from the
 * historical routes.ts launch handler). Once-set-always-used: body
 * value ?? persisted task value (v0.4.1 fix).
 */

import { PARAM_NAME_PATTERN } from "../../types/action-schema.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";

export interface ParsedLaunchBody {
  resume: boolean;
  dryRun: boolean;
  actionId: string | undefined;
  phase: string | undefined;
  phaseLabel: string | undefined;
  description: string | undefined;
  autonomy: "autonomous" | "guided" | undefined;
  userParams: Record<string, string | boolean> | undefined;
  phaseTaskRefRaw: unknown;
  /** FR-01.34 — body-only campaign autonomous launch. The campaign branch
   *  validates the slug + builds the fixed command; this just surfaces the raw
   *  string (or undefined). Never persisted on the task (launch-body only). */
  campaignSlug: string | undefined;
  /** FR-01.36 — body-only single-sub-iterate launch. The campaign-step branch
   *  validates slug + stepId, resolves the step's specPath server-side, and
   *  builds `/shipwright-iterate "<specPath>"`. Launch-body only (never
   *  persisted). Undefined unless both slug + stepId are non-empty strings. */
  campaignStep: { slug: string; stepId: string } | undefined;
}

/**
 * Parses the launch body into normalized fields + applies the
 * once-set-always-used contract (v0.4.1): body field falls back to the
 * persisted task value when omitted, so a bare `{ resume }` payload
 * from useLaunchTask still gets the correct actionId/phase/description.
 *
 * Returns `{ error }` on invalid `parameters` shape (400
 * `invalid_parameters_body`); otherwise the parsed fields.
 */
export function parseLaunchBody(
  body: Record<string, unknown>,
  task: ExternalTask,
):
  | ParsedLaunchBody
  | { error: { error: string; detail: string }; status: 400 } {
  const resume = Boolean(body.resume);
  const dryRun = Boolean(body.dryRun);

  // Once-set-always-used: body value ?? persisted task value.
  const bodyActionId =
    typeof body.actionId === "string" && body.actionId.trim().length > 0
      ? body.actionId.trim()
      : undefined;
  const bodyPhase =
    typeof body.phase === "string" && body.phase.trim()
      ? body.phase.trim()
      : undefined;
  const bodyPhaseLabel =
    typeof body.phaseLabel === "string" && body.phaseLabel.trim()
      ? body.phaseLabel.trim()
      : undefined;
  const taskActionId =
    typeof task.actionId === "string" && task.actionId.trim().length > 0
      ? task.actionId
      : undefined;

  const description =
    typeof body.description === "string" && body.description.length > 0
      ? body.description
      : task.description;
  const autonomy =
    body.autonomy === "autonomous" || body.autonomy === "guided"
      ? (body.autonomy as "autonomous" | "guided")
      : undefined;

  // iterate/launch-cli-parameters § 5 — body parameters validation.
  let userParams: Record<string, string | boolean> | undefined;
  if (body.parameters !== undefined) {
    if (
      body.parameters === null ||
      typeof body.parameters !== "object" ||
      Array.isArray(body.parameters)
    ) {
      return {
        error: {
          error: "invalid_parameters_body",
          detail: "parameters must be an object",
        },
        status: 400,
      };
    }
    userParams = {};
    for (const [k, v] of Object.entries(
      body.parameters as Record<string, unknown>,
    )) {
      if (!PARAM_NAME_PATTERN.test(k)) {
        return {
          error: { error: "invalid_parameters_body", detail: `bad key: ${k}` },
          status: 400,
        };
      }
      if (typeof v !== "string" && typeof v !== "boolean") {
        return {
          error: {
            error: "invalid_parameters_body",
            detail: `value for ${k} must be string or boolean`,
          },
          status: 400,
        };
      }
      userParams[k] = v;
    }
  }

  // Empty / whitespace-only → absent (no campaign intent), like every other
  // body field. A whitespace-only slug therefore builds NO command (it never
  // reaches the campaign branch's validator) — injection-safe by construction.
  // A non-empty slug is validated in campaign-branch.ts (400 invalid_campaign_slug).
  const campaignSlug =
    typeof body.campaignSlug === "string" && body.campaignSlug.trim().length > 0
      ? body.campaignSlug.trim()
      : undefined;

  // Single-sub-iterate launch intent (FR-01.36). Only a well-formed
  // `{ slug, stepId }` object with both non-empty counts as present; anything
  // else is absent (no command), like every other body field. The campaign-step
  // branch validates slug + stepId against their regexes.
  let campaignStep: { slug: string; stepId: string } | undefined;
  const rawStep = body.campaignStep;
  if (rawStep && typeof rawStep === "object" && !Array.isArray(rawStep)) {
    const s = (rawStep as Record<string, unknown>).slug;
    const id = (rawStep as Record<string, unknown>).stepId;
    if (typeof s === "string" && s.trim().length > 0 && typeof id === "string" && id.trim().length > 0) {
      campaignStep = { slug: s.trim(), stepId: id.trim() };
    }
  }

  return {
    resume,
    dryRun,
    actionId: bodyActionId ?? taskActionId,
    phase: bodyPhase ?? task.phase,
    phaseLabel: bodyPhaseLabel ?? task.phaseLabel,
    description,
    autonomy,
    userParams,
    phaseTaskRefRaw: body.phaseTaskRef,
    campaignSlug,
    campaignStep,
  };
}
