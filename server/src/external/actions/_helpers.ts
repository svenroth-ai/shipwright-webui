/*
 * external/actions/_helpers.ts — actions-route helpers extracted from the
 * historical monolithic routes.ts.
 */

import {
  buildExternalLaunchCommand,
  InvalidPlaceholderError,
  UnknownPhaseError,
  type SubstitutionContext,
} from "../../core/actions-substitute.js";

/**
 * 256 KB cap on `.shipwright-webui/actions.json` upload payloads. The bundled default
 * is ~5 KB; 256 KB is generous for any legitimate per-project override and
 * tight enough to refuse accidental binary uploads or copy-paste of huge
 * files.
 */
export const ACTIONS_UPLOAD_MAX_BYTES = 256 * 1024;

/**
 * Dry-run the substitute pipeline against a template using placeholder-
 * allowlist-safe values; returns the first placeholder failure, or null.
 * Shared between the GET /actions route and unit tests.
 */
export function dryRunTemplate(
  template: string,
  actionId: string,
  phaseIds: string[],
): InvalidPlaceholderError | null {
  const ctx: SubstitutionContext = {
    project: { id: "dry-run", path: "/tmp/dry-run" },
    task: {
      uuid: "00000000-0000-0000-0000-000000000000",
      title: "dry run",
      phase: phaseIds[0] ?? "dry-run-phase",
      phase_label: "Dry Run",
    },
    pluginDirs: [],
    allowedPhaseIds: new Set([...phaseIds, "dry-run-phase"]),
    actionId,
  };
  try {
    buildExternalLaunchCommand({ template, ctx });
    return null;
  } catch (err) {
    if (err instanceof InvalidPlaceholderError) return err;
    if (err instanceof UnknownPhaseError) return null; // handled at launch time
    throw err;
  }
}
