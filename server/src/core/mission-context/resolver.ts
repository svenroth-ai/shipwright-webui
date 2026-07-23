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
  cache,
  CACHE_CAP,
  computeSourceRev,
  docFingerprint,
  integrityResult,
  readBounded,
} from "./resolver-parts.js";
export { _clearResolverCache } from "./resolver-parts.js";
// Re-exported so the detail endpoint keeps its single import site (§5.2).
export { readDocumentBody } from "./document-read.js";
import { loadFoldMap, specPath } from "./fold-map.js";
import { checkSquashMerged, extractPrMarker, readOriginSlug } from "./merge-check.js";
import { refreshMerge } from "./merge-refresh.js";
import { mintDocId } from "./doc-ids.js";
import { readIteratePointer } from "./pointer.js";
import { detectScenario } from "./scenario.js";
import { buildRequirementArtifact, buildSpecArtifact } from "./artifacts.js";
import { buildCommitArtifact } from "./artifacts-commit.js";
import { buildSlice2Artifacts, slice2RevPaths } from "./slice2-sources.js";
import { buildNonIterateContext } from "./slice3-sources.js";
import type { ResolveDeps, ResolveRequest, ResolveResult } from "./resolver-io.js";
import { eventsPath, iterateDocPath, readIterateDoc } from "./iterate-record.js";
import { resolveWorkCompleted } from "./merged-events.js";
import {
  campaignSpecCandidates,
  specCandidates,
  specHintCandidate,
} from "./spec-candidates.js";
import { recoverRunIdFromTranscript } from "./run-id-recovery.js";
import { chooseRoot, readAllowedRootsCached, resolveFirstDoc } from "./worktree-roots.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
  type MissionContextAssociation,
} from "./types.js";

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
  // LAZY. The table calls this only if rules 1-4 all miss (scenario.ts rule 5),
  // so a pointer-, association-, pipeline- or campaign-identified task pays
  // nothing; a successful recovery is persisted below, so a task that does reach
  // it pays once and never again.
  //
  // "At most once per resolve" is pinned by a TEST over the table
  // (recovery-schedule.test.ts) rather than by a memo guard here. The external
  // plan review proposed the guard for a future rule that consulted the footer
  // twice — but a guard would make that mistake invisible, and this is a hot
  // read path where silence is exactly what produced the finding being fixed.
  const decision = detectScenario({
    pointer,
    association: req.association ?? null,
    recoverTranscriptRunId: () =>
      recoverRunIdFromTranscript(projectRoot, req.transcript, sessionUuid),
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

  const runId = decision.runId;
  const slug = pointer.status === "ok" ? pointer.pointer.slug : null;
  const worktreePath = pointer.status === "ok" ? pointer.pointer.worktreePath : null;

  const roots = await readAllowedRootsCached(projectRoot, { git: deps.git });

  // A worktree git does not know is simply NOT USED as a read root — that is
  // `chooseRoot`'s contract, and it is the normal post-Finalize state, not an
  // integrity failure. MEASURED 2026-07-21: git registered 0 of this project's
  // 20 live pointers' worktrees (removed at Finalize, directory left behind),
  // and the earlier hard failure here erased all six artifacts for every one of
  // them although every run had its record in the main root. See ADR.
  const chosen = chooseRoot(roots, worktreePath);

  // --- Records (the spec candidates below are built from them). The event
  // lookup is (mtime,size)-indexed: ahead of the cache check it is a Map hit.
  const iterateDoc = readIterateDoc(projectRoot, runId);
  // Working tree first, then — for a FINISHED run whose worktree is gone
  // (`!isWorktree`) and whose row is not local — the default remote ref where
  // the squash landed it. This is the "merged but not pulled" case that
  // otherwise leaves only Decisions on the rail (merged-events.ts).
  const { events, mergedRefMiss } = await resolveWorkCompleted(
    projectRoot,
    runId,
    chosen.isWorktree,
    { git: deps.git },
  );
  const run = events.status === "found" ? events.run : null;

  // --- Spec: known layout, agent-doc hint, then that same campaign path rebuilt
  // from the never-evicted event log — APPENDED, so preference order is
  // unchanged and it only adds reach once the doc evicts (trg-92c0c36b).
  const hint = specHintCandidate(iterateDoc?.specHint);
  const candidates = [
    ...specCandidates(runId, slug),
    ...(hint ? [hint] : []),
    ...campaignSpecCandidates(chosen.root, run?.campaign, run?.subIterateId),
  ];
  const doc = resolveFirstDoc(chosen.root, candidates);

  // The rev covers EVERY source used, incl. the iterate + agent docs AND the
  // Slice-2 sources. An input missing from here is an input FROZEN by the cache.
  const rev = computeSourceRev(
    [
      ...baseRevPaths,
      iterateDocPath(projectRoot, runId),
      ...slice2RevPaths(projectRoot, runId),
      ...(doc.ok ? [doc.absolute] : []),
    ],
    [runId, chosen.root, req.taskId],
  );
  const cacheKey = `${projectRoot}::${sessionUuid}::${runId}`;
  // Persist on a LIVE pointer, and on a corroborated transcript recovery — which
  // is the whole point of the recovery: pay the scan once. Read back off the
  // WINNING rule, so the id and its provenance cannot disagree; an id that came
  // from the store is not re-persisted.
  const associate =
    decision.runIdSource === "pointer" || decision.runIdSource === "transcript" ? runId : null;
  const associateSource: MissionContextAssociation["source"] =
    decision.runIdSource === "transcript" ? "transcript_run_id" : "iterate_active_pointer";

  const hit = cache.get(cacheKey);
  if (hit && hit.rev === rev) {
    // NOT returned verbatim — merge is the one time-varying field and must be
    // re-derived, or it freezes at "pending" forever. See merge-refresh.ts.
    return {
      context: await refreshMerge(hit.context, projectRoot, req.transcript, deps),
      associateRunId: associate,
      associateSource,
    };
  }

  let documentId: string | null = null, title: string | null = null, specText: string | null = null;
  if (doc.ok) {
    // BY INDEX — a suffix-compare against the realpath misses on a leaf-casing
    // normalisation and silently pairs candidates[0] with the OTHER file's
    // fingerprint (see resolveFirstDoc).
    // BY INDEX — what resolveFirstDoc returns it for. See
    // resolver.candidate-pairing.test.ts for why re-deriving it is a trap.
    const rel = candidates[doc.index].join("/");
    title = rel.slice(rel.lastIndexOf("/") + 1);
    documentId = mintDocId({
      t: req.taskId,
      s: sessionUuid,
      p: projectRoot,
      r: runId,
      root: chosen.root,
      rel,
      rev,
      f: docFingerprint(doc.absolute),
    });
    specText = readBounded(doc.absolute);
  }

  const foldMap = loadFoldMap(projectRoot);

  // --- Commit + merge -------------------------------------------------------
  // The marker must belong to THIS project's own origin repo (a sibling repo's
  // PR number would grep our origin/main), and merge is only checked once the
  // run completed — a per-poll git call mid-run is waste (§5.3).
  const marker = extractPrMarker(req.transcript, await readOriginSlug(projectRoot, deps.git));
  const merge =
    run && marker
      ? await checkSquashMerged(projectRoot, marker.number, { git: deps.git, ...deps.merge })
      : "unknown";

  const slice2 = await buildSlice2Artifacts({
    projectRoot,
    runId,
    events,
    commit: run?.commit?.trim() || null,
    git: deps.git,
  });

  // CONTRACT §6 order: Spec · Requirement · Tests · Review · Decisions · Commit.
  const artifacts: ArtifactDescriptor[] = [
    buildSpecArtifact({
      documentId,
      title,
      denied: !doc.ok && doc.reason === "denied",
      fromWorktree: chosen.isWorktree,
      intent: run?.intent ?? null,
    }),
    buildRequirementArtifact({ foldMap, doc: iterateDoc, events, specText }),
    ...slice2.artifacts,
    buildCommitArtifact({ events, prNumber: marker?.number ?? null, prUrl: marker?.url ?? null, merge }),
  ];

  const requirement = artifacts[1];
  const servesFrId =
    requirement.kind === "requirement" && requirement.detail?.rows.length
      ? requirement.detail.rows[0].displayFrId
      : null;

  const context: MissionContext = {
    schemaVersion: MISSION_CONTEXT_SCHEMA_VERSION,
    scenario: "iterate",
    missionTabVisible: true,
    runId,
    // IN FLIGHT = git still registers the pointer's worktree AND the run has not
    // recorded completion. The worktree alone is a filesystem PROXY (external
    // plan review, openai MEDIUM): an abandoned or already-finished run can
    // leave a registered worktree behind, and "pending" for a run that is over
    // is the same lie in the other direction. A `work_completed` record is a
    // terminal fact, so it ends live-ness. Both inputs participate in `rev`
    // (`chosen.root` + the event log's mtime), so neither can freeze in cache.
    runLive: chosen.isWorktree && events.status !== "found",
    artifacts,
    tests: run?.tests ?? null,
    servesFrId,
    sourceRev: rev,
  };

  // A TRANSIENT git failure is not cached: git's answer is not a statted file,
  // so it cannot participate in `rev`, and caching it would pin Tests at
  // "currently unavailable" until an unrelated source file changed. A merged-ref
  // MISS is excluded for the same reason — the run may land on the ref after a
  // later fetch, which `rev` would not see; re-resolving is cheap (the ref blob
  // is TTL-cached in merged-events). A merged-ref HIT is stable and caches.
  if (slice2.cacheable && !mergedRefMiss) {
    if (cache.size >= CACHE_CAP) cache.clear();
    cache.set(cacheKey, { rev, context });
  }

  // `associate` comes from EVIDENCE — a validated pointer or a corroborated
  // footer — never from the task's `state`, which decays to `idle` on a parked
  // design gate. See association.ts.
  return { context, associateRunId: associate, associateSource };
}
