/*
 * core/mission-context/resolver-iterate.ts — the ITERATE-scenario branch of
 * `resolveMissionContext`, split out of resolver.ts (2026-08-31,
 * iterate-2026-08-31-mission-feed-gaps) to stay under the 300-line file-size
 * limit. Pure continuation of the same function body: `resolver.ts` handles
 * scenario detection and the non-iterate early returns, then hands off here
 * once `decision.scenario === "iterate"` with a resolved `runId`. Contract
 * and architecture notes live in resolver.ts's header.
 */

import {
  cache,
  CACHE_CAP,
  computeSourceRev,
  docFingerprint,
  readBounded,
} from "./resolver-parts.js";
import { loadFoldMap, SPEC_REL_PARTS, specPath } from "./fold-map.js";
import { checkSquashMerged, extractPrMarker, readOriginSlug } from "./merge-check.js";
import { refreshMerge } from "./merge-refresh.js";
import { mintDocId } from "./doc-ids.js";
import type { ReadPointerResult } from "./pointer.js";
import type { ScenarioDecision } from "./scenario.js";
import { buildRequirementArtifact, buildSpecArtifact } from "./artifacts.js";
import { buildCommitArtifact } from "./artifacts-commit.js";
import { buildSlice2Artifacts, slice2RevPaths } from "./slice2-sources.js";
import type { ResolveDeps, ResolveRequest, ResolveResult } from "./resolver-io.js";
import { iterateDocPath, readIterateDoc } from "./iterate-record.js";
import { resolveWorkCompleted } from "./merged-events.js";
import { campaignSpecCandidates, specCandidates, specHintCandidate } from "./spec-candidates.js";
import { toMissionTests } from "./artifacts-tests.js";
import { chooseRoot, readAllowedRootsCached, resolveFirstDoc } from "./worktree-roots.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
  type MissionContextAssociation,
} from "./types.js";

/** `decision.runId` resolved and non-null — caller has already checked. */
export async function resolveIterateContext(
  req: ResolveRequest,
  deps: ResolveDeps,
  decision: ScenarioDecision,
  runId: string,
  pointer: ReadPointerResult,
  baseRevPaths: string[],
): Promise<ResolveResult> {
  const { projectRoot, sessionUuid } = req;
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
  // Task terminal state is server-owned input, not a filesystem revision. It
  // must participate in the cache identity so a completed task cannot reuse a
  // previously-live context while its worktree and event log are unchanged.
  const cacheKey = `${projectRoot}::${sessionUuid}::${runId}::${req.taskTerminal ? "terminal" : "active"}`;
  // Report the id + source the route should persist — a LIVE pointer (rule
  // 2), a first association from a corroborated footer (rule 5), or a
  // confirmed supersession of a stale one (rule 2b, association.ts
  // `supersedeMissionContext`). Read back off the WINNING rule so the id and
  // its provenance cannot disagree; an id that already came from the store
  // (an unchanged association) is reported but the route's guard makes that
  // report a no-op write.
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
  const requirementsDocument = mintDocId({
    t: req.taskId,
    s: sessionUuid,
    p: projectRoot,
    r: runId,
    root: projectRoot,
    rel: SPEC_REL_PARTS.join("/"),
    rev,
    f: docFingerprint(specPath(projectRoot)),
  });

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
  // `runLive` retains its visual worktree meaning. Requirement planning has a
  // separate authority: the server-owned task state, which can mark a run
  // terminal while a worktree lingers (or active while root selection fell back).
  const runLive = chosen.isWorktree && !req.taskTerminal && events.status !== "found";
  const requirementLive = !req.taskTerminal && events.status !== "found";

  // CONTRACT §6 order: Spec · Requirement · Tests · Review · Decisions · Commit.
  const artifacts: ArtifactDescriptor[] = [
    buildSpecArtifact({
      documentId,
      title,
      denied: !doc.ok && doc.reason === "denied",
      fromWorktree: chosen.isWorktree,
      intent: run?.intent ?? null,
    }),
    buildRequirementArtifact({
      foldMap,
      doc: iterateDoc,
      events,
      specText,
      runLive: requirementLive,
      sourceDocument: {
        documentId: requirementsDocument,
        title: "Requirements specification",
      },
    }),
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
    runLive,
    artifacts,
    // Shares artifacts-tests.ts's constructor so this never diverges from
    // the Tests artifact's own `detail.results` on the `{0,0}` edge case.
    tests: run ? toMissionTests(run.tests, run.ts) : null,
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
