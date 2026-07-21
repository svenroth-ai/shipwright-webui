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
import {
  checkSquashMerged,
  extractPrMarker,
  readOriginSlug,
  type MergeCheckDeps,
} from "./merge-check.js";
import { refreshMerge } from "./merge-refresh.js";
import { mintDocId } from "./doc-ids.js";
import { readIteratePointer } from "./pointer.js";
import { detectScenario, type ScenarioInputs } from "./scenario.js";
import { buildRequirementArtifact, buildSpecArtifact } from "./artifacts.js";
import { buildCommitArtifact } from "./artifacts-commit.js";
import { buildSlice2Artifacts, slice2RevPaths } from "./slice2-sources.js";
import { buildNonIterateContext } from "./slice3-sources.js";
import type { CampaignFact } from "./campaign-artifacts.js";
import type { PipelineFact } from "./pipeline-artifacts.js";
import {
  eventsPath,
  findWorkCompleted,
  iterateDocPath,
  readIterateDoc,
} from "./iterate-record.js";
import {
  campaignSpecCandidates,
  specCandidates,
  specHintCandidate,
} from "./spec-candidates.js";
import {
  chooseRoot,
  isRegisteredWorktree,
  readAllowedRootsCached,
  resolveFirstDoc,
  type GitRunner,
} from "./worktree-roots.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
  type MissionContextAssociation,
} from "./types.js";

export interface ResolveRequest {
  taskId: string;
  sessionUuid: string;
  projectId: string;
  projectRoot: string;
  /** Server-read transcript (bounded tail) — never client-supplied (§5.1). */
  transcript: string;
  /** Task facts the server owns (from its own store, not the client). */
  phaseTaskId: string | null;
  taskRunId: string | null;
  campaignSlug: string | null;
  hasCampaignRecord: boolean;
  actions: ScenarioInputs["actions"];
  runConfigStatus: ScenarioInputs["runConfigStatus"];
  /**
   * S3 — native scenario facts, gathered server-side (external/facts-slice3.ts).
   * Optional so existing callers/tests compile; absent behaves as `unavailable`,
   * which SHOWS the artifacts rather than hiding them.
   */
  pipeline?: PipelineFact | null;
  campaign?: CampaignFact | null;
  /**
   * The task's persisted association. Read from the server's own store; it is
   * how a FINALIZED iterate still resolves after its pointer was pruned.
   */
  association?: MissionContextAssociation | null;
}

export interface ResolveDeps {
  git?: GitRunner;
  merge?: MergeCheckDeps;
}

/**
 * Resolve the Mission context. Pure read — the caller performs the association
 * write, because persistence needs the store's lock and this module stays
 * side-effect-free (making the "one write" auditable in exactly one place).
 */
export async function resolveMissionContext(
  req: ResolveRequest,
  deps: ResolveDeps = {},
): Promise<{ context: MissionContext; associateRunId: string | null }> {
  const { projectRoot, sessionUuid } = req;

  const pointer = readIteratePointer(projectRoot, sessionUuid);
  const decision = detectScenario({
    pointer,
    association: req.association ?? null,
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
    };
  }

  const runId = decision.runId;
  const slug = pointer.status === "ok" ? pointer.pointer.slug : null;
  const worktreePath = pointer.status === "ok" ? pointer.pointer.worktreePath : null;

  const roots = await readAllowedRootsCached(projectRoot, { git: deps.git });

  // A worktree git does not know is a tree we cannot vouch for.
  if (worktreePath && !isRegisteredWorktree(roots, worktreePath)) {
    return integrityResult(
      "iterate",
      true,
      computeSourceRev(baseRevPaths, [runId, "unregistered_worktree"]),
      "This run's working copy is not a registered worktree of this project.",
      runId,
    );
  }

  const chosen = chooseRoot(roots, worktreePath);

  // --- Records (the spec candidates below are built from them). The event
  // lookup is (mtime,size)-indexed: ahead of the cache check it is a Map hit.
  const iterateDoc = readIterateDoc(projectRoot, runId);
  const events = findWorkCompleted(projectRoot, runId);
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
  const associate = pointer.status === "ok" ? runId : null;

  const hit = cache.get(cacheKey);
  if (hit && hit.rev === rev) {
    // NOT returned verbatim — merge is the one time-varying field and must be
    // re-derived, or it freezes at "pending" forever. See merge-refresh.ts.
    return {
      context: await refreshMerge(hit.context, projectRoot, req.transcript, deps),
      associateRunId: associate,
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
    artifacts,
    tests: run?.tests ?? null,
    servesFrId,
    sourceRev: rev,
  };

  // A TRANSIENT git failure is not cached: git's answer is not a statted file,
  // so it cannot participate in `rev`, and caching it would pin Tests at
  // "currently unavailable" until an unrelated source file changed.
  if (slice2.cacheable) {
    if (cache.size >= CACHE_CAP) cache.clear();
    cache.set(cacheKey, { rev, context });
  }

  // `associate` is set by the POINTER validating — never by the task's `state`,
  // which decays to `idle` on a parked design gate. See association.ts.
  return { context, associateRunId: associate };
}
