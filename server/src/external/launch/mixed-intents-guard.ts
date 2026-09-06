/*
 * external/launch/mixed-intents-guard.ts — the three `mixed_launch_intents`
 * checks split out of routes.ts to keep that file ≤ 300 LOC. Each launch
 * intent (campaignSlug / campaignStep / masterRun) is mutually exclusive
 * with the others and with actionId / phaseTaskRef. Checked against the RAW
 * body (never the parsed/once-set-always-used values) so a task's persisted
 * `actionId` can never spuriously trip these — see routes.ts callers for
 * the FR-01.34 / FR-01.36 / webui-pipeline-convergence W2 provenance.
 */

import type { ParsedLaunchBody } from "./parse-body.js";

export interface MixedIntentsError {
  error: { error: "mixed_launch_intents"; detail: string };
  status: 400;
}

export function checkMixedLaunchIntents(
  body: Record<string, unknown>,
  parsed: ParsedLaunchBody,
): MixedIntentsError | null {
  if (
    typeof body.campaignSlug === "string" &&
    body.campaignSlug.trim().length > 0 &&
    (body.actionId !== undefined || body.phaseTaskRef !== undefined)
  ) {
    return {
      error: {
        error: "mixed_launch_intents",
        detail: "campaignSlug is mutually exclusive with actionId / phaseTaskRef",
      },
      status: 400,
    };
  }

  if (
    parsed.campaignStep &&
    (body.actionId !== undefined ||
      body.phaseTaskRef !== undefined ||
      (typeof body.campaignSlug === "string" && body.campaignSlug.trim().length > 0))
  ) {
    return {
      error: {
        error: "mixed_launch_intents",
        detail: "campaignStep is mutually exclusive with actionId / phaseTaskRef / campaignSlug",
      },
      status: 400,
    };
  }

  if (
    Boolean(body.masterRun) &&
    (body.actionId !== undefined ||
      body.phaseTaskRef !== undefined ||
      (typeof body.campaignSlug === "string" && body.campaignSlug.trim().length > 0) ||
      body.campaignStep !== undefined)
  ) {
    return {
      error: {
        error: "mixed_launch_intents",
        detail:
          "masterRun is mutually exclusive with actionId / phaseTaskRef / campaignSlug / campaignStep",
      },
      status: 400,
    };
  }

  return null;
}
