/*
 * external/launch/parse-body.ts — parseLaunchBody (extracted from the
 * historical routes.ts launch handler). Once-set-always-used: body
 * value ?? persisted task value (v0.4.1 fix).
 */

import { PARAM_NAME_PATTERN } from "../../types/action-schema.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";

/**
 * iterate-2026-09-17-codex-model-tier-parameterization, revised
 * 2026-09-18 after shipwright#771 — a closed, hand-maintained catalog enum
 * was withdrawn in favor of the same posture shipwright's own
 * `codex_review`/`codex_plan_review` config axis uses
 * (`shared/scripts/lib/codex_review_transport.py`'s
 * `_CODEX_MODEL_SLUG_PATTERN`): an unconditional SYNTACTIC allowlist, never
 * a live-catalog-pinned enum. #771's own architecture review rejected
 * catalog validation outright — "a standing dependency on an undocumented,
 * already-shifting CLI subcommand ... not worth it" — the exact dependency
 * `CODEX_IMPLEMENTATION_MODELS` (the withdrawn enum) had. Pattern mirrored
 * verbatim so both repos reject/accept the same slug shapes.
 */
export const CODEX_MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
  /** Campaign webui-pipeline-convergence W2 — body-only single-session master
   *  launch. The master-run branch validates the run against a readable
   *  single_session run_config + builds the fixed `/shipwright-run` command;
   *  this just surfaces the boolean intent. Launch-body only (never persisted). */
  masterRun: boolean;
  /** iterate-2026-09-17-codex-model-tier-parameterization — session-scoped
   *  Codex implementation-model override. Body-only (never persisted on the
   *  task, and no once-set-always-used fallback), same "only for this
   *  session" posture as Claude's review-model/plan-review-model. Deliberately
   *  NOT routed through `userParams`/the action-schema `parameters` pipeline
   *  — see the iterate spec's server-scope decision for why. */
  codexImplementationModel: string | undefined;
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
  // Once-set-always-used, same as actionId/phase/phaseLabel/description
  // above (iterate-2026-08-16-task-lifecycle-ux-fixes — this fallback was
  // missing: useLaunchTask's Resume/Launch CTAs POST a bare `{ resume }`,
  // so every launch past the very first (which came from NewIssueModal
  // and DID set body.autonomy explicitly) silently lost the task's
  // persisted autonomy and fell back to Claude's own default instead of
  // what the task was created — or edited — to run as).
  const bodyAutonomy =
    body.autonomy === "autonomous" || body.autonomy === "guided"
      ? (body.autonomy as "autonomous" | "guided")
      : undefined;
  const autonomy = bodyAutonomy ?? task.autonomy;

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

  // iterate-2026-09-17-codex-model-tier-parameterization, revised for
  // shipwright#771 — syntactic allowlist, not a catalog enum; trimmed first
  // so an incidental leading/trailing space from a free-text field doesn't
  // fail a slug that would otherwise match. An unrecognized shape fails
  // closed (400), never silently dropped or coerced to undefined.
  // Deliberately unconditional on task.runtime: a value irrelevant to a
  // Claude-runtime task (runtime-chokepoint.ts never reads it for one) is
  // still malformed-input-rejected rather than silently accepted, same
  // fail-closed posture as every other field this function validates.
  // Today's only caller (useNewIssueFormSubmit.ts) already gates on
  // runtime === "codex" before ever setting this field.
  let codexImplementationModel: string | undefined;
  if (body.codexImplementationModel !== undefined) {
    const trimmed =
      typeof body.codexImplementationModel === "string"
        ? body.codexImplementationModel.trim()
        : "";
    if (!CODEX_MODEL_SLUG_PATTERN.test(trimmed)) {
      return {
        error: {
          error: "invalid_codex_implementation_model",
          detail: `must match ${CODEX_MODEL_SLUG_PATTERN.source}`,
        },
        status: 400,
      };
    }
    codexImplementationModel = trimmed;
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
    masterRun: Boolean(body.masterRun),
    codexImplementationModel,
  };
}
