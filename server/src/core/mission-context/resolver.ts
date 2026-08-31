/*
 * core/mission-context/resolver.ts — orchestration (CONTRACT §5 / §5.2).
 *
 * Stateless read (Architecture rule 4) with ONE deliberate exception: the
 * durable `task.missionContext` association (see association.ts). `task.runId`
 * is deliberately NOT touched — it means a PIPELINE run and overloading it
 * would corrupt that join (external-review GPT #4).
 *
 * Caching is keyed `{projectRoot, sessionUuid, runId}` and validated by a
 * source-mtime `rev` (resolver-parts.ts); merge is refreshed per call
 * (merge-refresh.ts) because it is the one field no source file tracks.
 */

import {
  buildRecoveryThunk,
  computeSourceRev,
  integrityResult,
} from "./resolver-parts.js";
export { _clearResolverCache, _clearSupersessionMemo } from "./resolver-parts.js";
// Re-exported so the detail endpoint keeps its single import site (§5.2).
export { readDocumentBody } from "./document-read.js";
import { specPath } from "./fold-map.js";
import { eventsPath } from "./iterate-record.js";
import { readIteratePointer } from "./pointer.js";
import { detectScenario } from "./scenario.js";
import { buildNonIterateContext } from "./slice3-sources.js";
import { resolveIterateContext } from "./resolver-iterate.js";
import type { ResolveDeps, ResolveRequest, ResolveResult } from "./resolver-io.js";

// The call contract lives next door so this file stays within the size rule.
export type {
  ResolveDeps,
  ResolveRequest,
  ResolveResult,
} from "./resolver-io.js";

/**
 * Resolve the Mission context. Pure read — the caller performs the association
 * write, because persistence needs the store's lock and this module stays
 * side-effect-free (making the "one write" auditable in exactly one place).
 */
export async function resolveMissionContext(
  req: ResolveRequest,
  deps: ResolveDeps = {},
): Promise<ResolveResult> {
  const { projectRoot, sessionUuid } = req;

  const pointer = readIteratePointer(projectRoot, sessionUuid);
  // LAZY. Called only if rules 1-4 all miss (rule 5) or rule 2b is checking an
  // association for supersession — "at most once per resolve" is pinned by a
  // TEST over the table (recovery-schedule.test.ts), not a guard here (a guard
  // would make a future double-consult invisible, on a hot read path where
  // silence is what produced the finding being fixed). Rule 2b's use is
  // additionally throttled by transcript content — see `buildRecoveryThunk`
  // in resolver-parts.ts for why and how (iterate-2026-08-31-mission-feed-gaps).
  const decision = detectScenario({
    pointer,
    association: req.association ?? null,
    recoverTranscriptRunId: buildRecoveryThunk(
      projectRoot,
      sessionUuid,
      req.transcript,
      req.association?.runId ?? null,
    ),
    actions: req.actions,
    runConfigStatus: req.runConfigStatus,
    phaseTaskId: req.phaseTaskId,
    taskRunId: req.taskRunId,
    campaignSlug: req.campaignSlug,
    hasCampaignRecord: req.hasCampaignRecord,
  });

  const baseRevPaths = [specPath(projectRoot), eventsPath(projectRoot)];

  // A pointer that failed validation is an integrity signal, not an absence.
  if (decision.pointerInvalidReason) {
    return integrityResult(
      decision.scenario,
      decision.missionTabVisible,
      computeSourceRev(baseRevPaths, [decision.pointerInvalidReason]),
      "This session's run record could not be verified, so its artifacts are unavailable.",
      null,
    );
  }

  // Everything that is not a resolved iterate. S1 left scenarios 3 and 5 on
  // "today's behavior"; S3 gives them native artifacts (slice3-sources.ts).
  // Scenarios 1/4 and a hidden custom-actions tab still carry no rail.
  if (decision.scenario !== "iterate" || !decision.runId) {
    return {
      context: buildNonIterateContext({
        taskId: req.taskId,
        sessionUuid,
        projectRoot,
        scenario: decision.scenario,
        missionTabVisible: decision.missionTabVisible,
        baseRevPaths,
        pipeline: req.pipeline,
        campaign: req.campaign,
        campaignSlug: req.campaignSlug,
      }),
      associateRunId: null,
      associateSource: "iterate_active_pointer",
    };
  }

  // The iterate-scenario body (spec/requirement/commit artifact assembly,
  // caching, association) lives in resolver-iterate.ts — split out to stay
  // under the file-size limit; this hand-off is the sole call site.
  return resolveIterateContext(req, deps, decision, decision.runId, pointer, baseRevPaths);
}
